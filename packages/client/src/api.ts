// API abstraction: in Electron uses IPC to local DB (offline-first); in browser dev uses fetch to server.
// Both paths implement the same surface so the renderer is identical.

const electronApi = (typeof window !== 'undefined' ? (window as any).clinic : undefined) as
  | undefined
  | Record<string, (...args: any[]) => Promise<any>>;

// 浏览器 fallback 模式的后台会话 token（服务端对 /api/members、/api/exams、
// /api/payments 等接口要求 x-backend-token 头）。登录后存 localStorage。
const TOKEN_KEY = 'clinic_backend_token';
function getBackendToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

// 401 时提示输入后台密码，调 /api/auth/login 换取 token 存入 localStorage。
// 返回是否成功拿到 token。
async function loginForBackendToken(): Promise<boolean> {
  const password = window.prompt('需要后台密码才能继续（浏览器模式）');
  if (!password) return false;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) return false;
  const data = (await res.json().catch(() => null)) as { token?: string } | null;
  if (!data?.token) return false;
  try { localStorage.setItem(TOKEN_KEY, data.token); } catch { /* ignore */ }
  return true;
}

async function http<T = any>(method: string, path: string, body?: any): Promise<T> {
  const doFetch = () => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = getBackendToken();
    if (token) headers['x-backend-token'] = token;
    return fetch(path, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };
  let res = await doFetch();
  // 401: token 缺失/过期 —— 让用户输入后台密码登录后重试原请求一次。
  if (res.status === 401 && path !== '/api/auth/login') {
    const ok = await loginForBackendToken().catch(() => false);
    if (ok) res = await doFetch();
  }
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
  listMembers: (filters: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null)) as any,
    ).toString();
    return electronApi ? electronApi.listMembers(filters) : http('GET', `/api/members?${qs}`);
  },
  adjustLedger: (memberId: string, input: any) =>
    electronApi ? electronApi.adjustLedger({ memberId, input }) : http('POST', `/api/members/${memberId}/ledger`, input),
  updateMember: (memberId: string, input: any) =>
    electronApi ? electronApi.updateMember({ memberId, input }) : http('PUT', `/api/members/${memberId}`, input),

  // exams
  createExam: (input: any) => (electronApi ? electronApi.createExam(input) : http('POST', '/api/exams', input)),
  getExam: (id: string) => (electronApi ? electronApi.getExam(id) : http('GET', `/api/exams/${id}`)),
  listExams: (filters: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null)) as any,
    ).toString();
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
