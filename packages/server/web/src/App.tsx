import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, getToken, setToken } from './api';
import { Badge } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Members from './pages/Members';
import MemberDetail from './pages/MemberDetail';
import Exams from './pages/Exams';
import Revenue from './pages/Revenue';
import Performance from './pages/Performance';
import Config from './pages/Config';
import Anomaly from './pages/Anomaly';
import Recycle from './pages/Recycle';
import Audit from './pages/Audit';
import ExportPage from './pages/Export';

const NAV = [
  { to: '/', label: '仪表盘', end: true },
  { to: '/members', label: '会员查询' },
  { to: '/exams', label: '检查查询' },
  { to: '/revenue', label: '营业额统计' },
  { to: '/performance', label: '店员绩效' },
  { to: '/anomalies', label: '异常待复核' },
  { to: '/config', label: '配置管理' },
  { to: '/recycle', label: '回收站' },
  { to: '/audit', label: '操作日志' },
  { to: '/export', label: '数据导出' },
];

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    if (!getToken()) { setAuthed(false); return; }
    api.sessionValid().then((r) => setAuthed(!!r.valid)).catch(() => setAuthed(false));
  }, [loc.pathname]);

  if (authed === null) return <div className="flex h-screen items-center justify-center text-sm text-ink-500">检查登录状态…</div>;
  if (!authed) return <Login onOk={() => setAuthed(true)} />;

  return (
    <div className="flex h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-4">
          <div className="text-base font-semibold text-ink-900">眼科客户管理</div>
          <div className="text-xs text-ink-500">连锁后台</div>
        </div>
        <nav className="flex-1 overflow-auto py-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `block border-l-2 px-4 py-2.5 text-sm transition ${
                  isActive ? 'border-brand-500 bg-brand-50 font-medium text-brand-700' : 'border-transparent text-ink-700 hover:bg-slate-50'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <button
            className="w-full rounded-md bg-slate-100 px-3 py-2 text-xs text-ink-700 hover:bg-slate-200"
            onClick={async () => { await api.logout().catch(() => {}); setToken(null); setAuthed(false); nav('/'); }}
          >
            退出登录
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/members" element={<Members />} />
          <Route path="/members/:id" element={<MemberDetail />} />
          <Route path="/exams" element={<Exams />} />
          <Route path="/revenue" element={<Revenue />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/anomalies" element={<Anomaly />} />
          <Route path="/config" element={<Config />} />
          <Route path="/recycle" element={<Recycle />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
