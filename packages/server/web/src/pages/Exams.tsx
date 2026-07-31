import { useEffect, useState } from 'react';
import { api } from '../api';
import { Card, Input, Select, Button, Badge, EmptyState, fmtDate, fmtDateTime, fmtCents } from '../components/ui';

export default function Exams() {
  const [stores, setStores] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [filters, setFilters] = useState({ dept: '', storeId: '', status: '', daysToReview: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.listStores().then((s) => setStores(s || [])); load(); }, []);
  async function load() {
    setLoading(true);
    try {
      const r = await api.listExams({ dept: filters.dept, storeId: filters.storeId, status: filters.status, daysToReview: filters.daysToReview });
      setItems(r.items || []);
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">检查查询</h1>
        <p className="text-xs text-ink-500">共 {items.length} 条</p>
      </div>
      <Card title="筛选">
        <div className="grid grid-cols-5 gap-3">
          <Select value={filters.dept} onChange={(e) => setFilters((f) => ({ ...f, dept: e.target.value }))}>
            <option value="">全部部门</option>
            <option value="OPTICAL">配镜部</option>
            <option value="EYE">眼科部</option>
          </Select>
          <Select value={filters.storeId} onChange={(e) => setFilters((f) => ({ ...f, storeId: e.target.value }))}>
            <option value="">全部门店</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">全部状态</option>
            <option value="PENDING">待复查</option>
            <option value="CONTACTED">已联系</option>
            <option value="CONTACTED_NO_SHOW">已联系不到店</option>
            <option value="REVIEWED">已复查</option>
          </Select>
          <Input type="number" value={filters.daysToReview} onChange={(e) => setFilters((f) => ({ ...f, daysToReview: e.target.value }))} placeholder="距复查≤N天" />
          <Button onClick={load}>查询</Button>
        </div>
      </Card>
      <Card>
        {loading ? <EmptyState text="加载中…" /> : items.length === 0 ? <EmptyState text="暂无检查记录" /> :
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-500">
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-2">登记时间</th><th>姓名</th><th>手机号</th><th>年龄</th>
                  <th>部门</th><th>金额</th><th>距复查</th><th>登记人</th><th>登记门店</th><th>状态</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2">{fmtDateTime(e.registeredAt)}</td>
                    <td className="font-medium text-ink-900">{e.customerName}</td>
                    <td>{e.phone}</td>
                    <td>{e.age != null ? `${e.age}岁` : '—'}</td>
                    <td>{e.deptLabel}</td>
                    <td>{fmtCents(e.baseAmount)}</td>
                    <td>{e.daysToReview == null ? '—' : e.daysToReview < 0 ? <Badge tone="rose">逾期{-e.daysToReview}天</Badge> : e.daysToReview <= 7 ? <Badge tone="amber">{e.daysToReview}天后</Badge> : `${e.daysToReview}天后`}</td>
                    <td>{e.registeredBy}</td>
                    <td>{e.registeredStoreName}</td>
                    <td>{statusBadge(e.reviewStatus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </Card>
    </div>
  );
}
function statusBadge(s: string) {
  const tone = s === 'REVIEWED' ? 'green' : s === 'PENDING' ? 'amber' : s === 'CONTACTED' ? 'blue' : 'slate';
  const label = { PENDING: '待复查', CONTACTED: '已联系', CONTACTED_NO_SHOW: '已联系不到店', REVIEWED: '已复查' }[s] || s;
  return <Badge tone={tone as any}>{label}</Badge>;
}
