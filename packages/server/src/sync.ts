// Sync endpoints: device register, push (client -> server), pull (server -> client).
import { Router } from 'express';
import { prisma } from './db.js';
import { applySyncRecords, makeSyncRecord, SYNC_TABLES } from '@clinic/shared';
import type { SyncRecord, SyncTableName } from '@clinic/shared';
import { recomputeAnomalies } from './anomaly.js';
import { verifyPassword, PASSWORD_KEY } from './passwords.js';

export const syncRouter = Router();

// ---- Public store list for device binding (front desk needs this before local cache exists) ----
syncRouter.get('/device/stores', async (_req, res) => {
  const stores = await prisma.store.findMany({ where: { deletedAt: null }, orderBy: { code: 'asc' } });
  res.json(stores.map((s) => ({ id: s.id, code: s.code, name: s.name })));
});

// ---- Device registration (front-desk device binds to a store) ----
syncRouter.post('/device/register', async (req, res) => {
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
      data: { deviceCode, storeId: store.id, displayName: displayName || deviceCode },
    });
  } else {
    // re-bind to a different store requires backend password (already verified above).
    device = await prisma.device.update({ where: { id: device.id }, data: { storeId: store.id, displayName: displayName || device.displayName } });
  }
  return res.json({
    deviceId: device.id,
    deviceCode: device.deviceCode,
    storeId: store.id,
    storeCode: store.code,
    storeName: store.name,
    boundAt: device.boundAt,
  });
});

// ---- Push: client uploads pending local records ----
syncRouter.post('/push', async (req, res) => {
  const { deviceId, records } = req.body || { deviceId: '', records: [] as SyncRecord[] };
  if (!deviceId) return res.status(400).json({ error: 'missing deviceId' });

  const result = await applySyncRecords(prisma, records || []);
  // mark pushed ledgers as synced on server (they came from client; server copy is authoritative now)
  // Recompute anomalies for affected members.
  let anomalies: { memberId: string; field: string; value: number }[] = [];
  if (result.affectedMemberIds.length) {
    const found = await recomputeAnomalies(result.affectedMemberIds);
    anomalies = found.map((a) => ({ memberId: a.memberId, field: a.field, value: a.value }));
  }
  // update device lastSyncAt
  await prisma.device.update({ where: { id: deviceId }, data: { lastSyncAt: new Date() } }).catch(() => {});
  return res.json({ accepted: result.applied, rejected: result.skipped, anomalies });
});

// ---- Pull: client fetches records newer than its cursors ----
syncRouter.post('/pull', async (req, res) => {
  const { deviceId, cursors } = req.body || { deviceId: '', cursors: {} as Record<string, string> };
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
    const cursor = cursors[table];
    const dateField = TABLE_DATE[table] || 'updatedAt';
    const where: any = {};
    if (cursor) where[dateField] = { gt: new Date(cursor) };
    const rows = await delegate.findMany({ where, take: 500, orderBy: { [dateField]: 'asc' } });
    let maxDate = cursor || '';
    for (const row of rows) {
      out.push(makeSyncRecord(table, row));
      const d = row[dateField];
      if (d) { const iso = new Date(d).toISOString(); if (iso > maxDate) maxDate = iso; }
    }
    if (maxDate) newCursors[table] = maxDate;
  }

  return res.json({ records: out, cursors: newCursors, serverTime: new Date().toISOString() });
});

// ---- Health / ping ----
syncRouter.get('/ping', async (_req, res) => {
  const deviceCount = await prisma.device.count();
  return res.json({ ok: true, serverTime: new Date().toISOString(), devices: deviceCount });
});
