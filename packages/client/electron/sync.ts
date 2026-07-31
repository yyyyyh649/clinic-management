// Sync engine: pushes local changes, pulls server updates, detects online/offline.
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getPrisma } from './db.js';
import { getServerUrl, getDeviceIdentity } from './device.js';
import {
  applySyncRecords, makeSyncRecord, SYNC_TABLES,
} from '@clinic/shared';
import type { SyncRecord, SyncTableName } from '@clinic/shared';

interface SyncState {
  lastPushAt: Record<string, string>;   // per-table max timestamp pushed
  pullCursors: Record<string, string>;  // per-table last received timestamp
  online: boolean;
  lastSyncAt: string | null;
  pending: number;
}

const stateFile = () => path.join(app.getPath('userData'), 'sync-state.json');

function loadState(): SyncState {
  try {
    if (fs.existsSync(stateFile())) return JSON.parse(fs.readFileSync(stateFile(), 'utf-8'));
  } catch { /* ignore */ }
  return { lastPushAt: {}, pullCursors: {}, online: false, lastSyncAt: null, pending: 0 };
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
    body: JSON.stringify({ deviceId: device.deviceId, records }),
  });
  if (!res.ok) throw new Error(`push failed: ${res.status}`);
  const body = await res.json();
  state.lastPushAt = newPushAt;
  return body.accepted || 0;
}

async function pullOnce(): Promise<number> {
  const device = getDeviceIdentity();
  if (!device) return 0;
  const prisma = getPrisma();
  const res = await fetch(`${getServerUrl()}/api/pull`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: device.deviceId, cursors: state.pullCursors }),
  });
  if (!res.ok) throw new Error(`pull failed: ${res.status}`);
  const body = await res.json();
  await applySyncRecords(prisma, body.records || []);
  state.pullCursors = { ...state.pullCursors, ...body.cursors };
  return (body.records || []).length;
}

export async function syncOnce(): Promise<{ pushed: number; pulled: number; online: boolean }> {
  const online = await pingServer();
  state.online = online;
  if (!online) { state.pending = await countPending(); emit(); saveState(state); return { pushed: 0, pulled: 0, online: false }; }
  try {
    const pushed = await pushOnce();
    const pulled = await pullOnce();
    state.lastSyncAt = new Date().toISOString();
    state.pending = await countPending();
    emit(); saveState(state);
    return { pushed, pulled, online: true };
  } catch (e) {
    state.online = false;
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
