import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { api } from '../api';
import { Card, Input, Select, Button, fmtCents } from '../components/ui';

export default function Revenue() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [storeId, setStoreId] = useState('');
  const [stores, setStores] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);

  useEffect(() => { api.listStores().then((s) => setStores(s || [])); }, []);
  async function load() {
    const r = await api.revenue(year, month, storeId || undefined);
    setData(r);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (!data) return <div className="text-sm text-ink-500">加载中…</div>;
  const m = data.month;

  // Build chart data: each dept as a group with cash / storedConsume / total.
  const chartData = [
    { name: '配镜部', 现金营业额: m.optical.cashRevenue / 100, 储值消耗: m.optical.storedConsume / 100, 总营业额: m.optical.total / 100 },
    { name: '眼科部', 现金营业额: m.eye.cashRevenue / 100, 储值消耗: m.eye.storedConsume / 100, 总营业额: m.eye.total / 100 },
    { name: '全店合计', 现金营业额: m.totalCash / 100, 储值消耗: m.totalStored / 100, 总营业额: m.total / 100 },
  ];

  // Year series for the trend chart.
  const seriesData = (data.series || []).map((s: any) => ({
    name: `${s.month}月`,
    配镜部: s.optical.total / 100,
    眼科部: s.eye.total / 100,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink-900">营业额统计</h1>
          <p className="text-xs text-ink-500">配镜部/眼科部严格分开，含上月结转</p>
        </div>
        <div className="flex items-end gap-2">
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} placeholder="年" className="w-20" />
          <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-20">
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}月</option>)}
          </Select>
          <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="w-32">
            <option value="">全部门店</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Button onClick={load}>查询</Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-3">
        <KPI label="本月总营业额" value={fmtCents(m.total)} tone="blue" />
        <KPI label="配镜部总营业额" value={fmtCents(m.optical.total)} />
        <KPI label="眼科部总营业额" value={fmtCents(m.eye.total)} />
        <KPI label="本月新增现金充值" value={fmtCents(m.rechargeCashInMonth)} />
        <KPI label="本月新增储值" value={fmtCents(m.rechargeStoredInMonth)} />
        <KPI label="储值池总额（含结转）" value={fmtCents(m.poolStoredBase)} />
        <KPI label="结转下月现金池" value={fmtCents(m.carryCashToNext)} tone="amber" />
        <KPI label="结转下月储值池" value={fmtCents(m.carryStoredToNext)} tone="amber" />
      </div>

      <Card title={`${year}年${month}月 部门营业额对比（元）`}>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="现金营业额" fill="#2563eb" radius={[4, 4, 0, 0]} />
              <Bar dataKey="储值消耗" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="总营业额" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title={`${year}年 各月部门营业额趋势（元）`}>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={seriesData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="配镜部" fill="#2563eb" radius={[4, 4, 0, 0]} />
              <Bar dataKey="眼科部" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="储值池结转明细（本月公式）">
        <div className="space-y-2 text-sm">
          <div className="rounded-md bg-slate-50 p-3 font-mono text-xs text-ink-700">
            本月储值池总额 = 上月结转储值池余额 + 本月新增充值进储值池的金额<br/>
            &nbsp;&nbsp; = {fmtCents(m.poolStoredBase - m.rechargeStoredInMonth)} + {fmtCents(m.rechargeStoredInMonth)} = {fmtCents(m.poolStoredBase)}
          </div>
          <div className="rounded-md bg-slate-50 p-3 font-mono text-xs text-ink-700">
            本月现金充值总额（分摊基数）= 上月结转现金池余额 + 本月新增现金充值总额<br/>
            &nbsp;&nbsp; = {fmtCents(m.poolCashBase - m.rechargeCashInMonth)} + {fmtCents(m.rechargeCashInMonth)} = {fmtCents(m.poolCashBase)}
          </div>
          <div className="rounded-md bg-brand-50 p-3 font-mono text-xs text-brand-700">
            配镜部储值营业额 = (配镜部本月储值消耗 / 本月储值池总额) × 本月现金充值总额<br/>
            &nbsp;&nbsp; = ({fmtCents(m.optical.storedConsume)} / {fmtCents(m.poolStoredBase)}) × {fmtCents(m.poolCashBase)} = {fmtCents(m.optical.storedRevenue)}
          </div>
          <div className="rounded-md bg-emerald-50 p-3 font-mono text-xs text-emerald-700">
            眼科部储值营业额 = ({fmtCents(m.eye.storedConsume)} / {fmtCents(m.poolStoredBase)}) × {fmtCents(m.poolCashBase)} = {fmtCents(m.eye.storedRevenue)}
          </div>
          <div className="rounded-md bg-amber-50 p-3 font-mono text-xs text-amber-700">
            结转下月现金池 = {fmtCents(m.poolCashBase)} − ({fmtCents(m.optical.storedRevenue)} + {fmtCents(m.eye.storedRevenue)}) = {fmtCents(m.carryCashToNext)}<br/>
            结转下月储值池 = {fmtCents(m.poolStoredBase)} − ({fmtCents(m.optical.storedConsume)} + {fmtCents(m.eye.storedConsume)}) = {fmtCents(m.carryStoredToNext)}
          </div>
        </div>
      </Card>
    </div>
  );
}

function KPI({ label, value, tone }: { label: string; value: string; tone?: 'blue' | 'amber' }) {
  const cls = tone === 'blue' ? 'border-brand-200 bg-brand-50/40' : tone === 'amber' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200';
  return (
    <div className={`rounded-md border p-4 ${cls}`}>
      <div className="text-xs text-ink-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-ink-900">{value} 元</div>
    </div>
  );
}
