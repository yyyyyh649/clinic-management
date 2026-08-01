// 检查查询 (§5.2): filters, 需复查置顶, 距复查天数.
// B.6: default list shows only PAID exams; a "待支付" tab shows unpaid drafts
//      (with a 作废 button to discard an unfinished draft without using the recycle bin).
// §2.4: a "显示已废弃" toggle reveals superseded revisions (grey "已废弃" tag).
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Card, Input, Select, Button, Badge, EmptyState, fmtDateTime, fmtCents } from '../components/ui';

type Tab = 'paid' | 'unpaid';

export default function ExamQuery() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [stores, setStores] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [filters, setFilters] = useState({ dept: '', storeId: '', status: '', daysToReview: '' });
  const [tab, setTab] = useState<Tab>('paid');
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [voiding, setVoiding] = useState<string | null>(null);

  useEffect(() => { api.getStores().then((s: any) => setStores(s || [])); }, []);
  async function load() {
    setLoading(true);
    try {
      const days = sp.get('filter') === 'due' ? '7' : (filters.daysToReview || undefined);
      const include = tab === 'unpaid' ? 'unpaid' : showDiscarded ? 'discarded' : undefined;
      const r = await api.listExams({
        dept: filters.dept || undefined, storeId: filters.storeId || undefined,
        status: filters.status || undefined, daysToReview: days,
        include,
      });
      setItems(r.items || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [sp, tab, showDiscarded]);

  async function voidDraft(id: string) {
    if (!confirm('确认作废这条未支付的草稿？作废后不会出现在任何统计和列表里（不可恢复）。')) return;
    setVoiding(id);
    try {
      await api.voidExam(id);
      await load();
    } catch (e: any) {
      alert(e.message || '作废失败');
    } finally {
      setVoiding(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="检查查询">
        <div className="mb-3 flex items-center gap-2">
          <button
            className={`rounded-md px-3 py-1.5 text-sm ${tab === 'paid' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-ink-700 hover:bg-slate-200'}`}
            onClick={() => setTab('paid')}
          >已支付记录</button>
          <button
            className={`rounded-md px-3 py-1.5 text-sm ${tab === 'unpaid' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-ink-700 hover:bg-slate-200'}`}
            onClick={() => setTab('unpaid')}
          >待支付草稿</button>
          {tab === 'paid' && (
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-ink-600">
              <input type="checkbox" checked={showDiscarded} onChange={(e) => setShowDiscarded(e.target.checked)} />
              显示已废弃
            </label>
          )}
        </div>
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

      <Card title={`${tab === 'unpaid' ? '待支付草稿' : '已支付记录'} · 共 ${items.length} 条`}>
        {loading ? <EmptyState text="加载中…" /> :
          items.length === 0 ? <EmptyState text={tab === 'unpaid' ? '暂无待支付草稿' : '暂无检查记录'} /> :
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-500">
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-2">登记时间</th><th>姓名</th><th>手机号</th><th>年龄</th>
                  <th>部门</th><th>金额</th>{tab === 'paid' && <th>距复查</th>}<th>登记人</th><th>登记门店</th>{tab === 'paid' ? <th>状态</th> : <th>操作</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className={`border-b border-slate-100 hover:bg-slate-50 ${e.discardedAt ? 'opacity-60' : ''}`}>
                    <td className="py-2 cursor-pointer" onClick={() => nav(`/exam/${e.id}`)}>{fmtDateTime(e.registeredAt)}</td>
                    <td className="cursor-pointer font-medium text-ink-900" onClick={() => nav(`/exam/${e.id}`)}>{e.customerName}</td>
                    <td className="cursor-pointer" onClick={() => nav(`/exam/${e.id}`)}>{e.phone}</td>
                    <td className="cursor-pointer" onClick={() => nav(`/exam/${e.id}`)}>{e.age != null ? `${e.age}岁` : '—'}</td>
                    <td className="cursor-pointer" onClick={() => nav(`/exam/${e.id}`)}>{e.deptLabel}</td>
                    <td className="cursor-pointer" onClick={() => nav(`/exam/${e.id}`)}>{fmtCents(e.baseAmount)}</td>
                    {tab === 'paid' && (
                      <td className="cursor-pointer" onClick={() => nav(`/exam/${e.id}`)}>
                        {e.daysToReview == null ? '—' : e.daysToReview < 0 ? <Badge tone="rose">逾期{-e.daysToReview}天</Badge> : e.daysToReview <= 7 ? <Badge tone="amber">{e.daysToReview}天后</Badge> : `${e.daysToReview}天后`}
                      </td>
                    )}
                    <td className="cursor-pointer" onClick={() => nav(`/exam/${e.id}`)}>{e.registeredBy}</td>
                    <td className="cursor-pointer" onClick={() => nav(`/exam/${e.id}`)}>{e.registeredStoreName}</td>
                    {tab === 'paid' ? (
                      <td className="cursor-pointer" onClick={() => nav(`/exam/${e.id}`)}>
                        {e.discardedAt ? <Badge tone="slate">已废弃</Badge> : statusBadge(e.reviewStatus)}
                      </td>
                    ) : (
                      <td className="whitespace-nowrap">
                        <Button size="sm" onClick={() => nav(`/payment/${e.id}`)}>继续支付</Button>
                        <Button size="sm" variant="danger" className="ml-2" disabled={voiding === e.id} onClick={() => voidDraft(e.id)}>{voiding === e.id ? '作废中…' : '作废'}</Button>
                      </td>
                    )}
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
