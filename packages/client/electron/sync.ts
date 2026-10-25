// Sync engine: pushes local changes, pulls server updates, detects online/offline.
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getPrisma } from './db.js';
import { getServerUrl, getDeviceIdentity, getDeviceToken, saveDeviceToken } from './device.js';
import {
  applySyncRecords, makeSyncRecord, SYNC_TABLES, expireDueBeanBatches,
} from '@clinic/shared';
import type { SyncRecord, SyncTableName } from '@clinic/shared';

interface SyncState {
  lastPushAt: Record<string, string>;   // per-table max timestamp pushed
  pullCursors: Record<string, string>;  // per-table last received timestamp
  online: boolean;
  lastSyncAt: string | null;
  pending: number;
  lastError?: string | null;            // last sync error (HTTP or network), for diagnostics
}

const stateFile = () => path.join(app.getPath('userData'), 'sync-state.json');

function loadState(): SyncState {
  try {
    if (fs.existsSync(stateFile())) return JSON.parse(fs.readFileSync(stateFile(), 'utf-8'));
  } catch { /* ignore */ }
  return { lastPushAt: {}, pullCursors: {}, online: false, lastSyncAt: null, pending: 0, lastError: null };
}
function saveState(s: SyncState) {
  try { fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2)); } catch { /* ignore */ }
}

let state = loadState();
let listeners: Array<(s: SyncState) => void> = [];
let timer: NodeJS.Timeout | null = null;

export function onSyncStatus(cb: (s: SyncState) => void) {
  listeners.push(cb);
  cb(state);
  return () => { listeners = listeners.filter((l) => l !== cb); };
}
function emit() { for (const l of listeners) l(state); }

const TABLE_DATE: Record<string, string> = {
  Ledger: 'createdAt', PhoneHistory: 'changedAt', AuditLog: 'createdAt', RecycleBinEntry: 'deletedAt',
  Setting: 'updatedAt',
};
function dateField(table: SyncTableName): string { return TABLE_DATE[table] || 'updatedAt'; }

// HTTP error (server reachable, non-2xx response) — distinguished from network
// errors (fetch reject / timeout) so online=false is only set when the server
// is actually unreachable.
class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

// Pull pagination: server returns at most this many records per pull; keep
// pulling within one syncOnce until a short page arrives.
const PULL_PAGE_SIZE = 500;

// Pure config tables: only ever PULLED by the front desk (never written
// locally), so aligning lastPushAt with the pull cursor is safe for them.
// Bidirectional tables (Member/Customer/ExamRecord/Payment/...) must NOT be
// aligned: if the device clock lags the server, advancing lastPushAt to the
// server cursor would permanently skip unpushed local rows.
const CONFIG_ONLY_TABLES = new Set(['Store', 'Staff', 'TierRule', 'ExamTemplate', 'Brand', 'Setting']);

async function pingServer(): Promise<boolean> {
  const url = getServerUrl();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${url}/api/ping`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}

// Count local records not yet pushed (for the offline badge).
async function countPending(): Promise<number> {
  const prisma = getPrisma();
  let n = 0;
  for (const table of SYNC_TABLES) {
    const key = table.charAt(0).toLowerCase() + table.slice(1);
    const delegate = (prisma as any)[key];
    if (!delegate) continue;
    const df = dateField(table);
    const last = state.lastPushAt[table];
    const where: any = last ? { [df]: { gt: new Date(last) } } : {};
    n += await delegate.count({ where }).catch(() => 0);
  }
  return n;
}

async function pushOnce(): Promise<number> {
  const device = getDeviceIdentity();
  if (!device) return 0;
  const prisma = getPrisma();
  const records: SyncRecord[] = [];
  const newPushAt: Record<string, string> = { ...state.lastPushAt };

  for (const table of SYNC_TABLES) {
    const key = table.charAt(0).toLowerCase() + table.slice(1);
    const delegate = (prisma as any)[key];
    if (!delegate) continue;
    const df = dateField(table);
    const last = state.lastPushAt[table];
    const where: any = last ? { [df]: { gt: new Date(last) } } : {};
    const rows = await delegate.findMany({ where, take: 1000, orderBy: { [df]: 'asc' } });
    let maxDate = last || '';
    for (const row of rows) {
      records.push(makeSyncRecord(table, row));
      const d = row[df];
      if (d) { const iso = new Date(d).toISOString(); if (iso > maxDate) maxDate = iso; }
    }
    if (maxDate) newPushAt[table] = maxDate;
  }

  if (records.length === 0) return 0;

  const res = await fetch(`${getServerUrl()}/api/push`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: device.deviceId, deviceToken: getDeviceToken() || undefined, records }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new HttpError(`push failed: ${res.status}`, res.status);
  const body = (await res.json()) as { accepted?: number; deviceToken?: string };
  // Server may backfill a token for legacy devices — persist and reuse.
  if (body.deviceToken) saveDeviceToken(body.deviceToken);
  state.lastPushAt = newPushAt;
  return body.accepted || 0;
}

// One pull round-trip (single page). Returns the number of records received.
async function pullPage(): Promise<number> {
  const device = getDeviceIdentity();
  if (!device) return 0;
  const prisma = getPrisma();
  const res = await fetch(`${getServerUrl()}/api/pull`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: device.deviceId, deviceToken: getDeviceToken() || undefined, cursors: state.pullCursors }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new HttpError(`pull failed: ${res.status}`, res.status);
  const body = (await res.json()) as { records?: any[]; cursors?: Record<string, string>; deviceToken?: string };
  // Server may backfill a token for legacy devices — persist and reuse.
  if (body.deviceToken) saveDeviceToken(body.deviceToken);
  await applySyncRecords(prisma, body.records || []);
  state.pullCursors = { ...state.pullCursors, ...(body.cursors || {}) };
  // Align push cursors with pull cursors for PURE CONFIG TABLES ONLY
  // (Store/Staff/TierRule/ExamTemplate/Brand/Setting). These are only ever
  // PULLED by the front desk — the client never writes them, so lastPushAt
  // was never set and countPending treated every pulled row as "new" and
  // re-pushed it every cycle. Advancing lastPushAt to the pull cursor fixes
  // that. Bidirectional tables (Member/Customer/ExamRecord/Payment/Recharge/
  // Ledger/BeanBatch/PhoneHistory/...) are deliberately skipped: if the
  // device clock lags the server, adopting the server cursor would jump
  // lastPushAt past locally-written rows and they'd never be pushed again.
  for (const [table, cursor] of Object.entries(body.cursors || {})) {
    if (!CONFIG_ONLY_TABLES.has(table)) continue;
    const prev = state.lastPushAt[table];
    if (!prev || cursor > prev) state.lastPushAt[table] = cursor as string;
  }
  return (body.records || []).length;
}

async function pullOnce(): Promise<number> {
  const device = getDeviceIdentity();
  if (!device) return 0;
  const prisma = getPrisma();
  // Paginate until a short page (< PULL_PAGE_SIZE) arrives — the first full
  // sync of a large database needs many pages within a single syncOnce.
  let total = 0;
  for (;;) {
    const n = await pullPage();
    total += n;
    if (n < PULL_PAGE_SIZE) break;
  }
  // Bean expiry sweep after pull: newly synced batches may be past their expiresAt.
  // Idempotent (deterministic ledger id); creates local EXPIRE ledgers that will
  // push back to the server (dedup by id keeps it safe).
  await expireDueBeanBatches(prisma, new Date(), 'CLIENT').catch(() => {});
  return total;
}

// Reentrancy guard: the 30s interval tick and a manual "立即同步" click must
// not overlap (concurrent pushOnce would double-read the same pending rows).
let syncing = false;

export async function syncOnce(): Promise<{ pushed: number; pulled: number; online: boolean }> {
  if (syncing) return { pushed: 0, pulled: 0, online: state.online };
  syncing = true;
  try {
    return await doSyncOnce();
  } finally {
    syncing = false;
  }
}

async function doSyncOnce(): Promise<{ pushed: number; pulled: number; online: boolean }> {
  const online = await pingServer();
  state.online = online;
  if (!online) { state.pending = await countPending(); emit(); saveState(state); return { pushed: 0, pulled: 0, online: false }; }
  // Device not bound yet: still mark online + update lastSyncAt so the UI shows
  // "在线" instead of a stale "离线 · 数据更新于N小时前". Push/pull are no-ops
  // until device.json exists (handled inside pushOnce/pullOnce).
  const device = getDeviceIdentity();
  if (!device) {
    state.lastSyncAt = new Date().toISOString();
    state.pending = 0;
    emit(); saveState(state);
    return { pushed: 0, pulled: 0, online: true };
  }
  try {
    const pushed = await pushOnce();
    const pulled = await pullOnce();
    state.lastSyncAt = new Date().toISOString();
    state.online = true;
    state.lastError = null;
    state.pending = await countPending();
    emit(); saveState(state);
    return { pushed, pulled, online: true };
  } catch (e: any) {
    if (e instanceof HttpError) {
      // Server reachable but rejected the request (e.g. 500, 403): stay online,
      // just record the error. Don't flip the UI to 离线 for server-side faults.
      state.online = true;
      state.lastError = e.message;
    } else {
      // Network error (fetch reject / timeout): genuinely offline.
      state.online = false;
      state.lastError = e?.message || String(e);
    }
    state.pending = await countPending();
    emit(); saveState(state);
    throw e;
  }
}

export function getSyncStatus(): SyncState { return state; }

export function startSyncLoop() {
  if (timer) return;
  // run immediately, then every 30s.
  syncOnce().catch(() => {});
  timer = setInterval(() => { syncOnce().catch(() => {}); }, 30000);
}
export function stopSyncLoop() { if (timer) { clearInterval(timer); timer = null; } }
