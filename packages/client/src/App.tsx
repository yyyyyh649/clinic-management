import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useDevice, useSyncStatus, useReminders } from './hooks/useApp';
import { api, isElectron } from './api';
import { Badge } from './components/ui';
import MemberRegister from './pages/MemberRegister';
import ExamRegister from './pages/ExamRegister';
import Payment from './pages/Payment';
import MemberQuery from './pages/MemberQuery';
import ExamQuery from './pages/ExamQuery';
import DeviceSetup from './pages/DeviceSetup';
import MemberDetail from './pages/MemberDetail';
import ExamDetail from './pages/ExamDetail';
import Admin from './pages/Admin';

const NAV = [
  { to: '/member/register', label: '会员登记' },
  { to: '/exam/register', label: '检查登记' },
  { to: '/member', label: '会员查询' },
  { to: '/exam', label: '检查查询' },
  { to: '/admin', label: '后台管理' },
];

function SyncIndicator() {
  const s = useSyncStatus();
  if (!isElectron) return null;
  const online = s.online;
  const last = s.lastSyncAt ? new Date(s.lastSyncAt) : null;
  const ageMin = last ? Math.max(0, Math.floor((Date.now() - last.getTime()) / 60000)) : null;
  const ageLabel = ageMin === null ? '未同步' : ageMin === 0 ? '刚刚' : ageMin < 60 ? `${ageMin}分钟前` : `${Math.floor(ageMin / 60)}小时前`;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={`inline-block h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-rose-500'}`} />
      <span className={online ? 'text-emerald-700' : 'text-rose-700'}>
        {online ? '在线' : '离线'}
      </span>
      {!online && <span className="text-rose-600">· 数据更新于{ageLabel}</span>}
      {s.pending > 0 && (
        <span title={`本机还有 ${s.pending} 条记录尚未同步到云端服务器`} className="cursor-help">
          <Badge tone="amber">{s.pending}待传</Badge>
        </span>
      )}
      {online && s.pending === 0 && (
        <button className="text-ink-500 hover:text-brand-600" onClick={() => api.syncNow()}>立即同步</button>
      )}
    </div>
  );
}

function RemindersDots() {
  const r = useReminders();
  // 永久显示，没人满足时显示 0，点击进入对应列表（空列表）
  return (
    <div className="flex items-center gap-2 text-xs">
      <NavLink to="/member?filter=birthday" className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-amber-700 hover:bg-amber-100">
        <span>🎂 今日生日</span>
        <span className="rounded-full bg-rose-500 px-1.5 text-white">{r.birthdayToday}</span>
      </NavLink>
      <NavLink to="/exam?filter=due" className="flex items-center gap-1 rounded-full bg-rose-50 px-2 py-1 text-rose-700 hover:bg-rose-100">
        <span>⏰ 待复查</span>
        <span className="rounded-full bg-rose-500 px-1.5 text-white">{r.reviewDue}</span>
      </NavLink>
    </div>
  );
}

export default function App() {
  const { device, loading } = useDevice();
  const loc = useLocation();
  const onPayment = loc.pathname.startsWith('/payment');

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-ink-500">加载中…</div>;
  }

  // Device not bound in Electron -> show setup.
  if (isElectron && !device) {
    return <DeviceSetup />;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="text-base font-semibold text-ink-900">眼科客户管理系统</div>
          {device && (
            <Badge tone="blue">
              {device.storeName || '未绑定'} {device.storeCode ? `· ${device.storeCode}` : ''}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4">
          <RemindersDots />
          <SyncIndicator />
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <nav className="w-44 shrink-0 border-r border-slate-200 bg-white">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `block border-l-2 px-4 py-3 text-sm transition ${
                  isActive
                    ? 'border-brand-500 bg-brand-50 font-medium text-brand-700'
                    : 'border-transparent text-ink-700 hover:bg-slate-50'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <main className={`flex-1 overflow-auto ${onPayment ? '' : 'p-6'}`}>
          <Routes>
            <Route path="/" element={<Navigate to="/member/register" replace />} />
            <Route path="/member/register" element={<MemberRegister />} />
            <Route path="/exam/register" element={<ExamRegister />} />
            <Route path="/payment/:examId" element={<Payment />} />
            <Route path="/member" element={<MemberQuery />} />
            <Route path="/member/:id" element={<MemberDetail />} />
            <Route path="/exam" element={<ExamQuery />} />
            <Route path="/exam/:id" element={<ExamDetail />} />
            <Route path="/exam/:id/edit" element={<ExamRegister />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
