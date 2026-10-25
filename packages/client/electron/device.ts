// Device identity: bound to a store on first setup. Stored in userData/device.json.
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { DeviceIdentity } from '@clinic/shared';

const file = () => path.join(app.getPath('userData'), 'device.json');

// device.json shape: DeviceIdentity + deviceToken (server-issued, per-device
// credential returned by /api/device/register and by push/pull when the server
// backfills it for upgraded legacy devices).
export type StoredDeviceIdentity = DeviceIdentity & { deviceToken?: string };

export function getDeviceIdentity(): StoredDeviceIdentity | null {
  try {
    if (fs.existsSync(file())) return JSON.parse(fs.readFileSync(file(), 'utf-8'));
  } catch { /* ignore */ }
  return null;
}

export function saveDeviceIdentity(d: StoredDeviceIdentity) {
  fs.writeFileSync(file(), JSON.stringify(d, null, 2));
}

export function getDeviceToken(): string | null {
  return getDeviceIdentity()?.deviceToken || null;
}

// Persist/overwrite the device token (called by device register + sync layer
// whenever a response carries a new deviceToken).
export function saveDeviceToken(deviceToken: string) {
  const d = getDeviceIdentity();
  if (!d) return;
  saveDeviceIdentity({ ...d, deviceToken });
}

export function clearDeviceIdentity() {
  if (fs.existsSync(file())) fs.unlinkSync(file());
}

// Server URL (configurable; default localhost). Stored next to device.json.
const serverFile = () => path.join(app.getPath('userData'), 'server.json');
export function getServerUrl(): string {
  try {
    if (fs.existsSync(serverFile())) return JSON.parse(fs.readFileSync(serverFile(), 'utf-8')).url;
  } catch { /* ignore */ }
  return process.env.CLINIC_SERVER_URL || 'http://localhost:4000';
}
export function setServerUrl(url: string) {
  fs.writeFileSync(serverFile(), JSON.stringify({ url }, null, 2));
}
