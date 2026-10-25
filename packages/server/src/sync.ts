// Sync endpoints: device register, push (client -> server), pull (server -> client).
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { applySyncRecords, makeSyncRecord, pkField, SYNC_TABLES, expireDueBeanBatches } from '@clinic/shared';
import type { SyncRecord } from '@clinic/shared';
import { recomputeAnomalies } from './anomaly.js';
import { verifyPassword, PASSWORD_KEY } from './passwords.js';
import { ah } from './util.js';

export const syncRouter = Router();

// ---- Device sync credentials ----
// push/pull must identify a REGISTERED device and present its token. Devices
// registered before tokens existed get one issued lazily on first sync after
// upgrade (response carries `deviceToken`; the client persists it).
async function authenticateDevice(body: any):
  Promise<{ deviceId: string; issuedToken?: string } | { status: number; error: string }> {
  const { deviceId, deviceToken } = body || {};
  if (!deviceId || typeof deviceId !== 'string') return { status: 400, error: 'missing deviceId' };
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) return { status: 403, error: '设备未注册，请先完成设备绑定' };
  if (device.token) {
    if (deviceToken !== device.token) return { status: 403, error: '设备凭证无效，请重新绑定设备' };
    return { deviceId };
  }
  // Legacy device without a token: issue one now.
  const issuedToken = randomUUID();
  await prisma.device.update({ where: { id: device.id }, data: { token: issuedToken } });
  return { deviceId, issuedToken };
}

// ---- Public store list for device binding (front desk needs this before local cache exists) ----
syncRouter.get('/device/stores', ah(async (_req, res) => {
  const stores = await prisma.store.findMany({ where: { deletedAt: null }, orderBy: { code: 'asc' } });
  res.json(stores.map((s) => ({ id: s.id, code: s.code, name: s.name })));
}));

// ---- Device registration (front-desk device binds to a store) ----
syncRouter.post('/device/register', ah(async (req, res) => {
  const { password, storeCode, deviceCode, displayName } = req.body || {};
  // Backend password required to bind a device (DB-verified; spec F).
  const ok = await verifyPassword(prisma, PASSWORD_KEY.BACKEND, password || '');
  if (!ok) {
    return res.status(401).json({ error: '后台密码错误，无法注册设备' });
  }
  const store = await prisma.store.findFirst({ where: { code: storeCode, deletedAt: null } });
  if (!store) return res.status(404).json({ error: '门店不存在，请检查门店编码' });

  let device = await prisma.device.findFirst({ where: { deviceCode } });
  if (!device) {
    device = await prisma.device.create({
      data: { deviceCode, storeId: store.id, displayName: displayName || deviceCode, token: randomUUID() },
    });
  } else {
    // re-bind to a different store requires backend password (already verified above).
    device = await prisma.device.update({
      where: { id: device.id },
      data: {
        storeId: store.id,
        displayName: displayName || device.displayName,
        // Issue a token if this device predates sync credentials.
        ...(device.token ? {} : { token: randomUUID() }),
      },
    });
  }
  return res.json({
    deviceId: device.id,
    deviceCode: device.deviceCode,
    storeId: store.id,
    storeCode: store.code,
    storeName: store.name,
    boundAt: device.boundAt,
    deviceToken: device.token,
  });
}));

// Clamp client-supplied LWW timestamps: a device with a fast clock would
// otherwise win every future merge for that row (its bogus "updatedAt" stays
// the newest forever). Anything beyond now + tolerance is pulled back to now.
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
function clampFutureTimestamps(records: SyncRecord[]): void {
  const max = Date.now() + CLOCK_TOLERANCE_MS;
  for (const rec of records) {
    if (rec.updatedAt) {
      const t = new Date(rec.updatedAt).getTime();
      if (!Number.isNaN(t) && t > max) {
        rec.updatedAt = new Date(max).toISOString();
        if (rec.data && typeof rec.data === 'object') (rec.data as any).updatedAt = rec.updatedAt;
      }
    }
  }
}

// ---- Push: client uploads pending local records ----
syncRouter.post('/push', ah(async (req, res) => {
  const auth = await authenticateDevice(req.body);
  if ('error' in auth) return res.status(auth.status).json({ error: auth.error });
  const { records } = req.body || { records: [] as SyncRecord[] };

  clampFutureTimestamps(records || []);
  const result = await applySyncRecords(prisma, records || []);
  // Bean expiry sweep after merge: pulled/pushed batches may now be past due.
  // Idempotent (deterministic ledger id), so safe to run on every push.
  await expireDueBeanBatches(prisma).catch(() => {});
  // Mark pushed Ledgers as SYNCED on the server. Front-desk payments/recharges
  // create Ledger rows with syncStatus='PENDING' (origin='CLIENT'); once they
  // reach the server the server holds the authoritative copy, so they are by
  // definition synced. Without this, anomaly.ts (which only scans
  // syncStatus='SYNCED' ledgers to detect offline-overdraft) would never see
  // real front-desk transactions, leaving the safety net blind to the actual
  // business data — the earlier "mark pushed ledgers as synced" comment was
  // aspirational and never implemented. Idempotent: only flips PENDING -> SYNCED
  // (already-SYNCED rows are untouched), and Ledger is append-only with a
  // createdAt pull cursor so an updatedAt bump here cannot feed the sync loop.
  const pushedLedgerIds = (records || []).filter((r: SyncRecord) => r.table === 'Ledger').map((r: SyncRecord) => r.id);
  if (pushedLedgerIds.length) {
    await prisma.ledger.updateMany({
      where: { id: { in: pushedLedgerIds }, syncStatus: 'PENDING' },
      data: { syncStatus: 'SYNCED' },
    }).catch(() => {});
  }
  // Recompute anomalies for affected members.
  let anomalies: { memberId: string; field: string; value: number }[] = [];
  if (result.affectedMemberIds.length) {
    const found = await recomputeAnomalies(result.affectedMemberIds);
    anomalies = found.map((a) => ({ memberId: a.memberId, field: a.field, value: a.value }));
  }
  // update device lastSyncAt via RAW SQL — a Prisma client update would auto-bump
  // Device.updatedAt (@updatedAt), which then syncs back to the client and makes
  // the Device record count as "pending" on every single sync cycle forever
  // (server bumps updatedAt -> client pulls -> countPending sees it as newer ->
  // pushes back -> server bumps again...). Raw SQL touches only lastSyncAt, so
  // updatedAt stays unchanged and the sync loop stays closed.
  await prisma.$executeRawUnsafe('UPDATE "Device" SET "lastSyncAt" = ? WHERE "id" = ?', new Date().toISOString(), auth.deviceId).catch(() => {});
  return res.json({
    accepted: result.applied, rejected: result.skipped, anomalies,
    ...(auth.issuedToken ? { deviceToken: auth.issuedToken } : {}),
  });
}));

// ---- Pull: client fetches records newer than its cursors ----
// Cursor format: `${isoDate}|${pk}` (composite so rows sharing the exact same
// millisecond can't be skipped at a page boundary). Legacy plain-ISO cursors
// from older clients are accepted (id part defaults to '').
function parseCursor(raw: unknown): { d: Date; id: string } | null {
  if (!raw || typeof raw !== 'string') return null;
  const bar = raw.indexOf('|');
  const d = new Date(bar === -1 ? raw : raw.slice(0, bar));
  if (Number.isNaN(d.getTime())) return null;
  return { d, id: bar === -1 ? '' : raw.slice(bar + 1) };
}

syncRouter.post('/pull', ah(async (req, res) => {
  const auth = await authenticateDevice(req.body);
  if ('error' in auth) return res.status(auth.status).json({ error: auth.error });
  const { cursors } = req.body || { cursors: {} as Record<string, string> };
  const out: SyncRecord[] = [];
  const newCursors: Record<string, string> = {};

  const TABLE_DATE: Record<string, string> = {
    Ledger: 'createdAt', PhoneHistory: 'changedAt', AuditLog: 'createdAt', RecycleBinEntry: 'deletedAt',
    Setting: 'updatedAt',
  };
  for (const table of SYNC_TABLES) {
    const key = table.charAt(0).toLowerCase() + table.slice(1);
    const delegate = (prisma as any)[key];
    if (!delegate) continue;
    const dateField = TABLE_DATE[table] || 'updatedAt';
    const pk = pkField(table);
    const cursor = parseCursor((cursors as any)[table]);
    const where: any = {};
    if (cursor) {
      where.OR = [
        { [dateField]: { gt: cursor.d } },
        { [dateField]: { equals: cursor.d, [pk]: { gt: cursor.id } } },
      ];
    }
    const rows = await delegate.findMany({
      where, take: 500,
      orderBy: [{ [dateField]: 'asc' }, { [pk]: 'asc' }],
    });
    let last: { d: string; id: string } | null = null;
    for (const row of rows) {
      out.push(makeSyncRecord(table, row));
      const d = row[dateField];
      if (d) last = { d: new Date(d).toISOString(), id: String(row[pk]) };
    }
    if (last) newCursors[table] = `${last.d}|${last.id}`;
    else if ((cursors as any)[table]) newCursors[table] = (cursors as any)[table];
  }

  return res.json({
    records: out, cursors: newCursors, serverTime: new Date().toISOString(),
    ...(auth.issuedToken ? { deviceToken: auth.issuedToken } : {}),
  });
}));

// ---- Health / ping ----
syncRouter.get('/ping', ah(async (_req, res) => {
  const deviceCount = await prisma.device.count();
  return res.json({ ok: true, serverTime: new Date().toISOString(), devices: deviceCount });
}));
