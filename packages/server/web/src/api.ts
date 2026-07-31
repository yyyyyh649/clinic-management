// Admin API client: stores backend token in localStorage, sends as x-backend-token.
const TOKEN_KEY = 'clinic.backend.token';

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY);
}

async function http<T = any>(method: string, path: string, body?: any): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      'x-backend-token': getToken() || '',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try { msg = JSON.parse(text).error || msg; } catch { /* keep */ }
    const err: any = new Error(msg); err.status = res.status; throw err;
  }
  try { return JSON.parse(text) as T; } catch { return text as any; }
}

export const api = {
  login: (password: string) => http<{ token: string; expiresAt: number }>('POST', '/api/auth/login', { password }),
  logout: () => http('POST', '/api/auth/logout'),
  verifyChange: (password: string) => http<{ ok: boolean }>('POST', '/api/auth/verify-change', { password }),
  sessionValid: () => http<{ valid: boolean }>('GET', '/api/auth/session'),
  // F: change a password (BACKEND or CHANGE). Requires current password verification first.
  changePassword: (key: 'BACKEND' | 'CHANGE', current: string, next: string) =>
    http<{ ok: boolean }>('POST', '/api/auth/change-password', { key, current, next }),

  // members / exams
  listMembers: (filters: Record<string, string>) => {
    const qs = new URLSearchParams(filters).toString();
    return http('GET', `/api/members?${qs}`);
  },
  getMember: (id: string) => http('GET', `/api/members/${id}`),
  updateMember: (id: string, input: any) => http('PUT', `/api/members/${id}`, input),
  adjustLedger: (id: string, input: any) => http('POST', `/api/members/${id}/ledger`, input),
  listMemberUsage: (id: string) => http('GET', `/api/members/${id}/usage`),
  dedupCustomer: (phone: string, name: string) => http('GET', `/api/members/customers/dedup?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`),
  listExams: (filters: Record<string, string>) => {
    const qs = new URLSearchParams(filters).toString();
    return http('GET', `/api/exams?${qs}`);
  },
  getExam: (id: string) => http('GET', `/api/exams/${id}`),
  updateReview: (id: string, input: any) => http('PUT', `/api/exams/${id}/review`, input),

  // stats
  dashboard: () => http('GET', '/api/stats/dashboard'),
  revenue: (year: number, month: number, storeId?: string) =>
    http('GET', `/api/stats/revenue?year=${year}&month=${month}${storeId ? `&storeId=${storeId}` : ''}`),
  performance: (year: number, month: number, storeId?: string) =>
    http('GET', `/api/stats/performance?year=${year}&month=${month}${storeId ? `&storeId=${storeId}` : ''}`),
  performanceByStaff: (staffId: string, year: number) =>
    http('GET', `/api/stats/performance/${staffId}?year=${year}`),
  anomalies: () => http('GET', '/api/stats/anomalies'),
  anomalyLedgers: (id: string) => http('GET', `/api/stats/anomalies/${id}/ledgers`),
  resolveAnomaly: (id: string, input: any) => http('POST', `/api/stats/anomalies/${id}/resolve`, input),
  recycle: () => http('GET', '/api/stats/recycle'),
  restoreRecycle: (id: string) => http('POST', `/api/stats/recycle/${id}/restore`),
  deleteRecycle: (id: string) => http('DELETE', `/api/stats/recycle/${id}`),
  audit: (filters: Record<string, string>) => {
    const qs = new URLSearchParams(filters).toString();
    return http('GET', `/api/stats/audit?${qs}`);
  },
  exportUrl: (type: string, storeId?: string) => `/api/stats/export/${type}${storeId ? `?storeId=${storeId}` : ''}`,

  // config
  listStores: () => http('GET', '/api/config/stores'),
  createStore: (input: any) => http('POST', '/api/config/stores', input),
  updateStore: (id: string, input: any) => http('PUT', `/api/config/stores/${id}`, input),
  deleteStore: (id: string) => http('DELETE', `/api/config/stores/${id}`),
  listDevices: () => http('GET', '/api/config/devices'),
  deleteDevice: (id: string) => http('DELETE', `/api/config/devices/${id}`),
  listStaff: () => http('GET', '/api/config/staff'),
  createStaff: (input: any) => http('POST', '/api/config/staff', input),
  updateStaff: (id: string, input: any) => http('PUT', `/api/config/staff/${id}`, input),
  deleteStaff: (id: string) => http('DELETE', `/api/config/staff/${id}`),
  listTiers: () => http('GET', '/api/config/tiers'),
  createTier: (input: any) => http('POST', '/api/config/tiers', input),
  updateTier: (id: string, input: any) => http('PUT', `/api/config/tiers/${id}`, input),
  deleteTier: (id: string) => http('DELETE', `/api/config/tiers/${id}`),
  listTemplates: (dept?: string) => http('GET', `/api/config/templates${dept ? `?dept=${dept}` : ''}`),
  createTemplate: (input: any) => http('POST', '/api/config/templates', input),
  updateTemplate: (id: string, input: any) => http('PUT', `/api/config/templates/${id}`, input),
  deleteTemplate: (id: string) => http('DELETE', `/api/config/templates/${id}`),
  listBrands: (type?: string) => http('GET', `/api/config/brands${type ? `?type=${type}` : ''}`),
  createBrand: (input: any) => http('POST', '/api/config/brands', input),
  updateBrand: (id: string, input: any) => http('PUT', `/api/config/brands/${id}`, input),
  deleteBrand: (id: string) => http('DELETE', `/api/config/brands/${id}`),
  getSettings: () => http('GET', '/api/config/settings'),
  updateSettings: (entries: Record<string, string>) => http('PUT', '/api/config/settings', entries),
};
