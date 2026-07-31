// Sync helpers: which tables sync, append-only vs mutable, serialization.
import type { SyncTableName, SyncRecord } from './types.js';

// Tables that participate in two-way sync.
export const SYNC_TABLES: SyncTableName[] = [
  'Store', 'Device', 'Staff',
  'Customer', 'PhoneHistory', 'Member',
  'Ledger', 'BeanBatch',
  'ExamRecord', 'Payment', 'Recharge',
  'TierRule', 'Setting', 'ExamTemplate', 'Brand',
  'AnomalyRecord', 'RecycleBinEntry', 'AuditLog',
];

// Append-only tables: dedup by id on push (INSERT OR IGNORE), never updated.
export const APPEND_ONLY: Set<SyncTableName> = new Set<SyncTableName>([
  'Ledger', 'PhoneHistory', 'AuditLog', 'RecycleBinEntry',
]);

// Date fields to parse from ISO strings when applying pulled records.
export const DATE_FIELDS: Record<string, string[]> = {
  Store: ['createdAt', 'updatedAt', 'deletedAt'],
  Device: ['boundAt', 'lastSyncAt', 'createdAt', 'updatedAt'],
  Staff: ['createdAt', 'updatedAt', 'deletedAt'],
  Customer: ['birthday', 'createdAt', 'updatedAt', 'deletedAt'],
  PhoneHistory: ['changedAt'],
  Member: ['registeredAt', 'deletedAt', 'createdAt', 'updatedAt'],
  Ledger: ['createdAt', 'syncedAt'],
  BeanBatch: ['expiresAt', 'createdAt'],
  ExamRecord: ['reviewDate', 'registeredAt', 'createdAt', 'updatedAt', 'deletedAt'],
  Payment: ['createdAt', 'updatedAt'],
  Recharge: ['createdAt', 'updatedAt'],
  TierRule: ['createdAt', 'updatedAt'],
  ExamTemplate: ['createdAt', 'updatedAt', 'deletedAt'],
  Brand: ['createdAt', 'deletedAt'],
  AnomalyRecord: ['createdAt', 'resolvedAt'],
  RecycleBinEntry: ['deletedAt'],
  Setting: ['updatedAt'],
};

export function makeSyncRecord(table: SyncTableName, row: Record<string, unknown>): SyncRecord {
  return {
    table,
    id: String(row.id),
    data: row,
    updatedAt: row.updatedAt ? String(row.updatedAt) : (row.createdAt ? String(row.createdAt) : new Date().toISOString()),
    deletedAt: row.deletedAt ? String(row.deletedAt) : null,
  };
}
