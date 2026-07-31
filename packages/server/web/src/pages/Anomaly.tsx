import { useEffect, useState } from 'react';
import { api } from '../api';
import { Card, Button, Badge, Modal, TextArea, EmptyState, fmtCents, fmtDateTime } from '../components/ui';

export default function Anomaly() {
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [ledgers, setLedgers] = useState<any[]>([]);
  const [resolve, setResolve] = useState('');

  async function load() {
    const r = await api.anomalies();
    setItems(r.items || []);
  }
  useEffect(() => { load(); }, []);

  async function viewDetail(a: any) {
    const r = await api.anomalyLedgers(a.id);
    setSelected(a); setLedgers(r.ledgers || []); setResolve('');
  }

  async function doResolve() {
    if (!resolve.trim()) return;
    await api.resolveAnomaly(selected.id, { resolvedByName: '后台', resolveNote: resolve });
    setSelected(null);
    await load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">异常待复核</h1>
        <p className="text-xs text-ink-500">断网期间多端并发操作合并后，余额/豆变成负数的会员，需要人工电话核实后手动调整</p>
      </div>
      <Card>
        {items.length === 0 ? <EmptyState text="暂无异常记录" /> :
          <div className="space-y-2">
            {items.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-rose-700">{a.memberName} · {a.memberCardNo}</div>
                  <div className="text-xs text-rose-600">{a.field === 'BALANCE' ? '卡内余额' : '豆'} = {fmtCents(a.currentValue)} · {a.detail}</div>
                  <div className="text-xs text-ink-500">发生时间：{fmtDateTime(a.createdAt)} · 涉及 {a.conflictLedgerIds.length} 笔冲突流水</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="rose">{a.status}</Badge>
                  <Button size="sm" onClick={() => viewDetail(a)}>查看明细</Button>
                </div>
              </div>
            ))}
          </div>}
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`异常复核 · ${selected?.memberName || ''}`} wide
        footer={<><Button variant="ghost" onClick={() => setSelected(null)}>取消</Button><Button disabled={!resolve.trim()} onClick={doResolve}>标记已解决</Button></>}>
        {selected && (
          <div className="space-y-3">
            <div className="rounded-md bg-rose-50 p-3 text-sm">
              <div>会员：{selected.memberName} · 卡号 {selected.memberCardNo}</div>
              <div>异常字段：{selected.field === 'BALANCE' ? '卡内余额' : '豆'} 当前值 {fmtCents(selected.currentValue)}</div>
              <div className="mt-1 text-xs text-ink-500">{selected.detail}</div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold text-ink-700">冲突流水明细</div>
              <div className="max-h-60 overflow-auto rounded-md border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="text-xs text-ink-500"><tr className="border-b border-slate-200 text-left"><th className="py-2 px-3">时间</th><th>字段</th><th>增减</th><th>原因</th><th>门店</th></tr></thead>
                  <tbody>
                    {ledgers.map((l) => (
                      <tr key={l.id} className="border-b border-slate-100">
                        <td className="py-2 px-3">{fmtDateTime(l.createdAt)}</td>
                        <td>{l.field === 'BALANCE' ? '卡内余额' : '豆'}</td>
                        <td className={l.delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{l.delta >= 0 ? '+' : ''}{l.field === 'BALANCE' ? fmtCents(l.delta) : l.delta}</td>
                        <td className="max-w-xs truncate">{l.reason}</td>
                        <td className="text-xs">{l.storeName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <div className="label">核实说明（必填）：电话核实后请在此说明核实结果，并视情况通过会员详情页 Ledger 增量调整</div>
              <TextArea rows={3} value={resolve} onChange={(e) => setResolve(e.target.value)} placeholder="如：已与分店核实，会员实际余额 200 元，差额系断网期间重复扣款导致，已通过会员详情页修正" />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
