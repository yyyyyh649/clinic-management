import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { api } from '../api';
import { Card, Input, Select, Button, Badge, fmtCents } from '../components/ui';

export default function Performance() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [storeId, setStoreId] = useState('');
  const [stores, setStores] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [staffDetail, setStaffDetail] = useState<any>(null);

  useEffect(() => { api.listStores().then((s) => setStores(s || [])); }, []);
  async function load() {
    const r = await api.performance(year, month, storeId || undefined);
    setData(r);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (!data) return <div className="text-sm text-ink-500">加载中…</div>;

  const chartData = data.items.map((it: any) => ({
    name: it.staffName,
    业绩_元: it.opticalConsumeCents / 100,
    提成_元: it.commissionCents / 100,
    开卡数: it.openCount,
  }));

  async function viewStaffMonths(staffId: string, staffName: string) {
    const r = await api.performanceByStaff(staffId, year);
    setStaffDetail({ name: staffName, items: r.items });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink-900">店员绩效</h1>
          <p className="text-xs text-ink-500">仅算配镜部业绩（实际余额消耗值）；阶梯提成按全连锁合并后总业绩计算（2万以内4%，超过部分7%）</p>
        </div>
        <div className="flex items-end gap-2">
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-20" />
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

      <Card title={`${year}年${month}月 各店员业绩与提成`}>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="业绩_元" fill="#2563eb" radius={[4, 4, 0, 0]} />
              <Bar dataKey="提成_元" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="明细">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-500">
              <tr className="border-b border-slate-200 text-left">
                <th className="py-2">店员</th><th>配镜部业绩</th><th>阶梯提成</th><th>开卡数</th><th>门店拆分</th><th>品牌激励</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it: any) => (
                <tr key={it.staffId} className="border-b border-slate-100">
                  <td className="py-2 font-medium text-ink-900">{it.staffName}</td>
                  <td>{fmtCents(it.opticalConsumeCents)} 元</td>
                  <td className="text-emerald-700">{fmtCents(it.commissionCents)} 元</td>
                  <td>{it.openCount}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {it.storeBreakdown.map((b: any, i: number) => (
                        <Badge key={i} tone="slate">{b.storeName}: {fmtCents(b.consume)}</Badge>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="text-xs text-ink-500">
                      {it.brands?.lens && Object.entries(it.brands.lens).map(([k, v]) => <span key={k} className="mr-2">镜片{k}×{v as number}</span>)}
                      {it.brands?.frame && Object.entries(it.brands.frame).map(([k, v]) => <span key={k} className="mr-2">镜架{k}×{v as number}</span>)}
                      {(!it.brands?.lens || Object.keys(it.brands.lens).length === 0) && (!it.brands?.frame || Object.keys(it.brands.frame).length === 0) && '—'}
                    </div>
                  </td>
                  <td><Button size="sm" variant="ghost" onClick={() => viewStaffMonths(it.staffId, it.staffName)}>按月查看</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {staffDetail && (
        <Card title={`${staffDetail.name} · ${year}年各月业绩（柱状图）`} extra={<Button size="sm" variant="ghost" onClick={() => setStaffDetail(null)}>关闭</Button>}>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={staffDetail.items.map((it: any) => ({ name: `${it.month}月`, 业绩_元: it.consume / 100, 提成_元: it.commission / 100 }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="业绩_元" fill="#2563eb" radius={[4, 4, 0, 0]} />
                <Bar dataKey="提成_元" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-500"><tr className="border-b border-slate-200 text-left"><th className="py-2">月份</th><th>业绩</th><th>提成</th><th>门店拆分</th></tr></thead>
              <tbody>
                {staffDetail.items.map((it: any) => (
                  <tr key={it.month} className="border-b border-slate-100">
                    <td className="py-2">{it.month}月</td>
                    <td>{fmtCents(it.consume)}</td>
                    <td>{fmtCents(it.commission)}</td>
                    <td>{it.storeBreakdown.map((b: any) => `${b.storeName}:${fmtCents(b.consume)}`).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
