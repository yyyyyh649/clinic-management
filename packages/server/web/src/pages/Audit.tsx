import { useEffect, useState } from 'react';
import { api } from '../api';
import { Card, Input, Select, Button, EmptyState, fmtDateTime } from '../components/ui';

export default function Audit() {
  const now = new Date();
  const [filters, setFilters] = useState({ year: String(now.getFullYear()), month: '', day: '', action: '', entityType: '' });
  const [items, setItems] = useState<any[]>([]);

  async function load() {
    const r = await api.audit({ year: filters.year, month: filters.month, day: filters.day, action: filters.action, entityType: filters.entityType });
    setItems(r.items || []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">操作日志</h1>
        <p className="text-xs text-ink-500">按月/天查询全部修改记录</p>
      </div>
      <Card title="筛选">
        <div className="grid grid-cols-5 gap-3">
          <Input type="number" value={filters.year} onChange={(e) => setFilters((f) => ({ ...f, year: e.target.value }))} placeholder="年" />
          <Select value={filters.month} onChange={(e) => setFilters((f) => ({ ...f, month: e.target.value }))}>
            <option value="">全月</option>
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}月</option>)}
          </Select>
          <Input type="number" value={filters.day} onChange={(e) => setFilters((f) => ({ ...f, day: e.target.value }))} placeholder="日（可选）" />
          <Select value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}>
            <option value="">全部动作</option>
            <option value="CREATE">创建</option>
            <option value="UPDATE">修改</option>
            <option value="DELETE">删除</option>
            <option value="LOGIN">登录</option>
            <option value="ADJUST">调整</option>
          </Select>
          <Button onClick={load}>查询</Button>
        </div>
      </Card>
      <Card title={`共 ${items.length} 条`}>
        {items.length === 0 ? <EmptyState text="暂无日志" /> :
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-500"><tr className="border-b border-slate-200 text-left"><th className="py-2">时间</th><th>动作</th><th>类型</th><th>记录ID</th><th>操作人</th><th>详情</th></tr></thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100">
                    <td className="py-2">{fmtDateTime(a.createdAt)}</td>
                    <td>{actionLabel(a.action)}</td>
                    <td>{a.entityType}</td>
                    <td className="font-mono text-xs">{a.entityId || '—'}</td>
                    <td>{a.operatorName || '—'}</td>
                    <td className="max-w-md truncate text-xs text-ink-500">{a.details ? JSON.stringify(a.details).slice(0, 120) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </Card>
    </div>
  );
}
function actionLabel(a: string) {
  return { CREATE: '创建', UPDATE: '修改', DELETE: '删除', LOGIN: '登录', ADJUST: '调整' }[a] || a;
}
