// Global app store: device identity, sync status, reminders (birthday + review counts).
import { useEffect, useState, useCallback } from 'react';
import { api, isElectron, onSyncStatus } from '../api';

export interface SyncStatus {
  online: boolean;
  lastSyncAt: string | null;
  pending: number;
}

export interface Reminders {
  birthdayToday: number;
  reviewDue: number;
}

let _deviceListeners: Array<(d: any) => void> = [];
export function subscribeDevice(cb: (d: any) => void) {
  _deviceListeners.push(cb);
  return () => { _deviceListeners = _deviceListeners.filter((l) => l !== cb); };
}
export function notifyDeviceChanged(d: any) {
  for (const l of _deviceListeners) l(d);
}

export function useDevice() {
  const [device, setDevice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!isElectron) { setDevice({ storeName: '浏览器开发模式', storeId: '', deviceId: '', storeCode: '' }); setLoading(false); return; }
    try { const d = await api.getDevice(); setDevice(d); } catch { /* ignore */ }
    setLoading(false);
  }, []);
  useEffect(() => {
    refresh();
    const off = subscribeDevice(refresh);
    return off;
  }, [refresh]);
  return { device, loading, refresh };
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({ online: !isElectron, lastSyncAt: null, pending: 0 });
  useEffect(() => {
    if (!isElectron) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    api.getSyncStatus().then((s) => { if (!cancelled) setStatus(s); });
    if (onSyncStatus) {
      off = onSyncStatus((s) => {
        setStatus({
          online: !!s.online,
          lastSyncAt: s.lastSyncAt,
          pending: s.pending ?? 0,
        });
      });
    } else {
      // Fallback: poll every 10s if no event channel (e.g. older preload).
      const t = setInterval(() => { api.getSyncStatus().then((s) => !cancelled && setStatus(s)); }, 10000);
      off = () => clearInterval(t);
    }
    return () => { cancelled = true; off?.(); };
  }, []);
  return status;
}

// 全局提醒红点（今日生日 + 待复查）。Electron 下走主进程的轻量聚合 IPC
//（getReminderCounts），不再每分钟全量拉 listMembers + listExams。
// 浏览器 fallback 没有该方法时保留旧的全量拉取逻辑。
export function useReminders() {
  const [r, setR] = useState<Reminders>({ birthdayToday: 0, reviewDue: 0 });
  useEffect(() => {
    let cancelled = false;
    const getCounts = (window as any).clinic?.getReminderCounts as undefined | (() => Promise<Reminders>);
    const compute = async () => {
      // 页面隐藏（最小化/切后台标签）时跳过本轮轮询。
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        if (getCounts) {
          const counts = await getCounts();
          if (!cancelled) setR({ birthdayToday: counts?.birthdayToday ?? 0, reviewDue: counts?.reviewDue ?? 0 });
          return;
        }
        if (isElectron) return; // Electron 但 preload 过旧没有该方法：静默置 0，不报错
        // 浏览器 fallback：保留原逻辑（全量拉取后在内存聚合）。
        const [members, exams] = await Promise.all([
          api.listMembers({}).catch(() => ({ items: [] })),
          api.listExams({}).catch(() => ({ items: [] })),
        ]);
        const now = new Date();
        const bm = now.getMonth(), bd = now.getDate();
        const birthdayToday = (members.items || []).filter((m: any) => {
          if (!m.birthday) return false;
          const d = new Date(m.birthday); return d.getMonth() === bm && d.getDate() === bd;
        }).length;
        const reviewDue = (exams.items || []).filter((e: any) => e.needsReview).length;
        if (!cancelled) setR({ birthdayToday, reviewDue });
      } catch { /* ignore */ }
    };
    compute();
    const t = setInterval(compute, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  return r;
}
