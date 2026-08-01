// API abstraction: in Electron uses IPC to local DB (offline-first); in browser dev uses fetch to server.
// Both paths implement the same surface so the renderer is identical.

const electronApi = (typeof window !== 'undefined' ? (window as any).clinic : undefined) as
  | undefined
  | Record<string, (...args: any[]) => Promise<any>>;

async function http<T = any>(method: string, path: string, body?: any): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try { msg = JSON.parse(text).error || msg; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  try { return JSON.parse(text) as T; } catch { return text as any; }
}

export const isElectron = !!electronApi;

// Live sync status subscription (Electron-only; no-op in browser).
export const onSyncStatus: undefined | ((cb: (s: any) => void) => () => void) =
  electronApi?.onSyncStatus as any;

// ---- Device ----
export const api = {
  // server health / device
  pingServer: () => (electronApi ? electronApi.pingServer() : http('GET', '/api/ping')),
  getDevice: () => (electronApi ? electronApi.getDevice() : Promise.resolve(null)),
  registerDevice: (input: any) => (electronApi ? electronApi.registerDevice(input) : http('POST', '/api/device/register', input)),
  // server URL (Electron-only; browser uses relative fetch)
  getServerUrl: () => (electronApi ? electronApi.getServerUrl() : Promise.resolve('')),
  setServerUrl: (url: string) => (electronApi ? electronApi.setServerUrl(url) : Promise.resolve()),

  // sync status (Electron-only concept; browser returns always-online)
  getSyncStatus: () => (electronApi ? electronApi.getSyncStatus() : Promise.resolve({ online: true, lastSyncAt: null, pending: 0 })),
  syncNow: () => (electronApi ? electronApi.syncNow() : Promise.resolve({ ok: true })),

  // A: backend admin login (Electron-only). Verifies the shared backend password
  // against the server and returns { token, serverUrl }. The Admin page embeds
  // the server admin SPA with ?token=<token> for auto-login.
  adminLogin: (password: string) =>
    electronApi ? electronApi.adminLogin(password) : Promise.reject(new Error('后台管理仅在桌面客户端可用')),

  // customer dedup + member search (front desk, open)
  dedupCustomer: (phone: string, name: string) =>
    electronApi ? electronApi.dedupCustomer({ phone, name }) : http('GET', `/api/members/customers/dedup?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`),
  searchMembers: (q: string, byCard = false) =>
    electronApi ? electronApi.searchMembers({ q, byCard }) : http('GET', `/api/members/search?q=${encodeURIComponent(q)}&byCard=${byCard ? 1 : 0}`),

  // members
  registerMember: (input: any) => (electronApi ? electronApi.registerMember(input) : http('POST', '/api/members', input)),
  getMember: (id: string) => (electronApi ? electronApi.getMember(id) : http('GET', `/api/members/${id}`)),
  listMembers: (filters: Record<string, string | number>) => {
    const qs = new URLSearchParams(filters as any).toString();
    return electronApi ? electronApi.listMembers(filters) : http('GET', `/api/members?${qs}`);
  },
  adjustLedger: (memberId: string, input: any) =>
    electronApi ? electronApi.adjustLedger({ memberId, input }) : http('POST', `/api/members/${memberId}/ledger`, input),
  updateMember: (memberId: string, input: any) =>
    electronApi ? electronApi.updateMember({ memberId, input }) : http('PUT', `/api/members/${memberId}`, input),

  // exams
  createExam: (input: any) => (electronApi ? electronApi.createExam(input) : http('POST', '/api/exams', input)),
  getExam: (id: string) => (electronApi ? electronApi.getExam(id) : http('GET', `/api/exams/${id}`)),
  listExams: (filters: Record<string, string | number>) => {
    const qs = new URLSearchParams(filters as any).toString();
    return electronApi ? electronApi.listExams(filters) : http('GET', `/api/exams?${qs}`);
  },
  updateReview: (id: string, input: any) =>
    electronApi ? electronApi.updateReview({ id, input }) : http('PUT', `/api/exams/${id}/review`, input),
  // B.6: void an unpaid exam draft.
  voidExam: (id: string) =>
    electronApi ? electronApi.voidExam(id) : http('POST', `/api/exams/${id}/void`),
  // 修改检查单（需先通过 verifyChange 校验修改密码）。全字段可改，旧值预填。
  updateExam: (id: string, input: any) =>
    electronApi ? electronApi.updateExam({ id, input }) : http('PUT', `/api/exams/${id}`, input),
  // 敏感操作二次确认：校验 CHANGE 修改密码（向服务器验证）。
  verifyChange: (password: string) =>
    electronApi ? electronApi.verifyChange(password) : http<{ ok: boolean }>('POST', '/api/auth/verify-change', { password }),

  // payments + recharge
  createPayment: (input: any) => (electronApi ? electronApi.createPayment(input) : http('POST', '/api/payments', input)),
  createRecharge: (input: any) => (electronApi ? electronApi.createRecharge(input) : http('POST', '/api/payments/recharge', input)),

  // config (read-only for front desk)
  getStaff: () => (electronApi ? electronApi.getStaff() : http('GET', '/api/config/staff')),
  getTiers: () => (electronApi ? electronApi.getTiers() : http('GET', '/api/config/tiers')),
  getTemplates: (dept?: string) =>
    electronApi ? electronApi.getTemplates(dept) : http('GET', `/api/config/templates${dept ? '?dept=' + dept : ''}`),
  getBrands: (type?: string) =>
    electronApi ? electronApi.getBrands(type) : http('GET', `/api/config/brands${type ? '?type=' + type : ''}`),
  getStores: () => (electronApi ? electronApi.getStores() : http('GET', '/api/config/stores')),
  getSettings: () => (electronApi ? electronApi.getSettings() : http('GET', '/api/config/settings')),
};
