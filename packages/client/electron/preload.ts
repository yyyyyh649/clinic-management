// Preload: bridges renderer <-> main via ipcRenderer.invoke('clinic:<channel>', ...args).
// Exposes a flat `window.clinic` API matching the method names used by src/api.ts.
import { contextBridge, ipcRenderer } from 'electron';

const calls = [
  'pingServer', 'getDevice', 'registerDevice', 'getServerUrl', 'setServerUrl',
  'getSyncStatus', 'syncNow',
  'dedupCustomer', 'searchMembers',
  'registerMember', 'getMember', 'listMembers', 'adjustLedger', 'updateMember',
  'createExam', 'getExam', 'listExams', 'updateReview',
  'createPayment', 'createRecharge',
  'getStaff', 'getTiers', 'getTemplates', 'getBrands', 'getStores', 'getSettings',
] as const;

const api: Record<string, (...args: any[]) => any> = {};
for (const name of calls) {
  api[name] = (...args: any[]) => ipcRenderer.invoke(`clinic:${name}`, ...args);
}

// Live sync status subscription (for offline badge + payment-page offline warning).
api['onSyncStatus'] = (cb: (s: any) => void) => {
  const listener = (_e: unknown, s: any) => cb(s);
  ipcRenderer.on('clinic:syncStatus', listener);
  return () => ipcRenderer.removeListener('clinic:syncStatus', listener);
};

contextBridge.exposeInMainWorld('clinic', api);
