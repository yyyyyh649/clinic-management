import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Card, Input, Select, Button, Badge, EmptyState, fmtDate, fmtCents } from '../components/ui';

export default function Members() {
  const nav = useNavigate();
  const [tiers, setTiers] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [filters, setFilters] = useState({ tier: '', storeId: '', dateFrom: '', dateTo: '', ageMin: '', ageMax: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listTiers().then((t) => setTiers(t || []));
    api.listStores().then((s) => setStores(s || []));
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await api.listMembers({
        tier: filters.tier, storeId: filters.storeId, dateFrom: filters.dateFrom, dateTo: filters.dateTo,
        ageMin: filters.ageMin, ageMax: filters.ageMax,
      });
      setItems(r.items || []);
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink-900">会员查询</h1>
          <p className="text-xs text-ink-500">共 {items.length} 条</p>
        </div>
        <Link to="/export" className="text-xs text-brand-600">导出 CSV →</Link>
      </div>

      <Card title="筛选">
        <div className="grid grid-cols-6 gap-3">
          <Select value={filters.tier} onChange={(e) => setFilters((f) => ({ ...f, tier: e.target.value }))}>
            <option value="">全部档位</option>
            {tiers.map((t) => <option key={t.id} value={t.level}>{t.name}</option>)}
          </Select>
          <Select value={filters.storeId} onChange={(e) => setFilters((f) => ({ ...f, storeId: e.target.value }))}>
            <option value="">全部门店</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input type="date" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
          <Input type="date" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
          <Input type="number" value={filters.ageMin} onChange={(e) => setFilters((f) => ({ ...f, ageMin: e.target.value }))} placeholder="最小年龄" />
          <Input type="number" value={filters.ageMax} onChange={(e) => setFilters((f) => ({ ...f, ageMax: e.target.value }))} placeholder="最大年龄" />
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={load}>查询</Button></div>
      </Card>

      <Card>
        {loading ? <EmptyState text="加载中…" /> :
          items.length === 0 ? <EmptyState text="暂无会员" /> :
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-500">
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-2">姓名</th><th>手机号</th><th>卡号</th><th>生日/年龄</th>
                  <th>档位</th><th>累计积分</th><th>豆</th><th>余额</th>
                  <th>成为会员</th><th>登记人</th><th>登记门店</th><th>复查</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => nav(`/members/${m.id}`)}>
                    <td className="py-2 font-medium text-ink-900">{m.name}</td>
                    <td>{m.phone}</td>
                    <td>{m.cardNo}</td>
                    <td>{fmtDate(m.birthday)}{m.age != null ? ` / ${m.age}岁` : ''}</td>
                    <td><Badge tone="blue">{m.tierName}</Badge></td>
                    <td>{m.points}</td>
                    <td>{m.beans}</td>
                    <td>{fmtCents(m.balanceCents)}</td>
                    <td>{m.daysSince}天</td>
                    <td>{m.registeredBy}</td>
                    <td>{m.registeredStoreName}</td>
                    <td>{m.pendingReview ? <Badge tone="rose">待复查</Badge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </Card>
    </div>
  );
}
