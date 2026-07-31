import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../api';
import { Card, Badge, fmtCents } from '../components/ui';

export default function Dashboard() {
  const [d, setD] = useState<any>(null);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  useEffect(() => {
    api.dashboard().then(setD);
    api.anomalies().then((r) => setAnomalies(r.items || []));
  }, []);
  if (!d) return <div className="text-sm text-ink-500">加载中…</div>;

  const cards = [
    { label: '总会员数', value: d.memberCount, tone: 'blue' as const, link: '/members' },
    { label: '总检查数', value: d.examCount, tone: 'slate' as const, link: '/exams' },
    { label: '今日新增会员', value: d.todayNewMembers, tone: 'green' as const, link: '/members' },
    { label: '今日生日会员', value: d.birthdayToday, tone: 'amber' as const, link: '/members' },
    { label: '待复查', value: d.reviewDue, tone: 'amber' as const, link: '/exams' },
    { label: '异常待复核', value: d.openAnomalies, tone: 'rose' as const, link: '/anomalies' },
  ];

  // 配置汇总（用户反馈：在后台查不到总店员数/品牌/档位/模板数，补到首页仪表盘方便一眼看到）
  const configCards = [
    { label: '在职店员', value: d.staffCount, sub: '点击查看全部店员', link: '/config' },
    { label: '品牌', value: d.brandCount, sub: '镜片+镜架，全连锁共用', link: '/config' },
    { label: '会员档位', value: d.tierCount, sub: '最多20档', link: '/config' },
    { label: '检查模板', value: d.templateCount, sub: '病历/验光单各最多10个', link: '/config' },
  ];

  const chartData = [
    { name: '会员', value: d.memberCount },
    { name: '检查', value: d.examCount },
    { name: '待复查', value: d.reviewDue },
    { name: '异常', value: d.openAnomalies },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">仪表盘</h1>
        <p className="text-xs text-ink-500">关键指标概览</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Link key={c.label} to={c.link} className="card block p-4 hover:shadow-md">
            <div className="text-xs text-ink-500">{c.label}</div>
            <div className="mt-2 text-2xl font-semibold text-ink-900">{c.value}</div>
            <div className="mt-1"><Badge tone={c.tone}>查看</Badge></div>
          </Link>
        ))}
      </div>

      <Card title="配置概览" extra={<Link to="/config" className="text-xs text-brand-600">配置管理 →</Link>}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {configCards.map((c) => (
            <Link key={c.label} to={c.link} className="block rounded-md border border-slate-200 p-3 hover:border-brand-300 hover:bg-brand-50/40">
              <div className="text-xs text-ink-500">{c.label}</div>
              <div className="mt-1 text-xl font-semibold text-ink-900">{c.value}</div>
              <div className="mt-0.5 text-xs text-ink-400">{c.sub}</div>
            </Link>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card title="指标对比">
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="异常待复核" extra={<Link to="/anomalies" className="text-xs text-brand-600">全部 →</Link>}>
          {anomalies.length === 0 ? (
            <div className="py-8 text-center text-sm text-ink-500">暂无异常</div>
          ) : (
            <div className="space-y-2">
              {anomalies.slice(0, 5).map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium text-rose-700">{a.memberName || '—'}</div>
                    <div className="text-xs text-rose-600">{a.field === 'BALANCE' ? '余额' : '豆'} = {fmtCents(a.currentValue)}</div>
                  </div>
                  <Badge tone="rose">{a.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
