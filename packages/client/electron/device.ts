// Device identity: bound to a store on first setup. Stored in userData/device.json.
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { DeviceIdentity } from '@clinic/shared';

const file = () => path.join(app.getPath('userData'), 'device.json');

export function getDeviceIdentity(): DeviceIdentity | null {
  try {
    if (fs.existsSync(file())) return JSON.parse(fs.readFileSync(file(), 'utf-8'));
  } catch { /* ignore */ }
  return null;
}

export function saveDeviceIdentity(d: DeviceIdentity) {
  fs.writeFileSync(file(), JSON.stringify(d, null, 2));
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
