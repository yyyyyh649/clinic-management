import { useEffect, useState } from 'react';
import { api } from '../api';
import { Card, Button, Badge, EmptyState, fmtDateTime } from '../components/ui';

export default function Recycle() {
  const [items, setItems] = useState<any[]>([]);
  async function load() { setItems((await api.recycle()).items || []); }
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">回收站</h1>
        <p className="text-xs text-ink-500">删除的记录保留30天，期间不能二次删除；标注来源门店</p>
      </div>
      <Card>
        {items.length === 0 ? <EmptyState text="回收站为空" /> :
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-500"><tr className="border-b border-slate-200 text-left"><th className="py-2">类型</th><th>记录ID</th><th>删除时间</th><th>操作人</th><th>来源门店</th><th></th></tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-slate-100">
                  <td className="py-2"><Badge tone="slate">{typeLabel(e.entityType)}</Badge></td>
                  <td className="font-mono text-xs">{e.entityId}</td>
                  <td>{fmtDateTime(e.deletedAt)}</td>
                  <td>{e.deletedByName}</td>
                  <td>{e.sourceStoreName || '—'}</td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm('恢复此记录？')) api.restoreRecycle(e.id).then(load).catch((e: any) => alert(e.message || '恢复失败')); }}>恢复</Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm('永久删除？此操作不可撤销')) api.deleteRecycle(e.id).then(load).catch((e: any) => alert(e.message || '删除失败')); }}>永久删除</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>}
      </Card>
    </div>
  );
}
function typeLabel(t: string) {
  return { CUSTOMER: '客户', MEMBER: '会员', EXAM: '检查', STORE: '门店', STAFF: '店员', BRAND: '品牌', TEMPLATE: '模板', TIER: '档位' }[t] || t;
}
