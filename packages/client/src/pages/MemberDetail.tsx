// 会员详情 (§5.1): full info + 累计积分/豆 clear separation + exam history (cross-store) + ledger edit + 代付 usage.
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Card, Button, Badge, Modal, Field, Input, Select, TextArea, EmptyState, fmtDate, fmtDateTime, fmtCents } from '../components/ui';

const LEDGER_FIELDS = [
  { value: 'BALANCE', label: '卡内余额（元，正=充值，负=扣减）' },
  { value: 'BEANS', label: '豆（正=获得，负=消耗）' },
  { value: 'POINTS', label: '累计积分（正=获得，负=清零）' },
];

export default function MemberDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<any>(null);
  const [showAdj, setShowAdj] = useState(false);
  const [staff, setStaff] = useState<any[]>([]);
  const [adj, setAdj] = useState({ field: 'BALANCE', delta: '', reason: '', operatorId: '', cashReceivedYuan: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    if (!id) return;
    const r = await api.getMember(id);
    setData(r);
  }
  useEffect(() => { load(); api.getStaff().then((s: any) => setStaff(s || [])); /* eslint-disable-next-line */ }, [id]);

  async function submitAdj() {
    setErr('');
    if (!adj.delta || !adj.reason.trim()) { setErr('增减量和备注必填'); return; }
    if (!adj.operatorId) { setErr('请选择操作人'); return; }
    setBusy(true);
    try {
      const op = staff.find((s) => s.id === adj.operatorId);
      const cents = adj.field === 'BALANCE' ? Math.round(parseFloat(adj.delta) * 100) : parseInt(adj.delta, 10);
      await api.adjustLedger(id!, {
        field: adj.field, delta: cents, reason: adj.reason,
        operatorId: adj.operatorId, operatorName: op?.name || '',
        cashReceivedYuan: adj.cashReceivedYuan || undefined,
      });
      setShowAdj(false);
      setAdj({ field: 'BALANCE', delta: '', reason: '', operatorId: '', cashReceivedYuan: '' });
      await load();
    } catch (e: any) {
      setErr(e.message || '调整失败');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="text-sm text-ink-500">加载中…</div>;
  const { member, customer, balances, tier, exams, usagePayments, ledgers, beanBatches } = data;

  // B.5: replace the internal "可用豆批次" concept with a useful "最近到期提醒".
  // If bean expiry is disabled (all batches have null expiresAt) show nothing;
  // otherwise find the earliest-expiring batch that still has remaining beans.
  const expiryReminder = (() => {
    const active = (beanBatches || []).filter((b: any) => !b.expired && b.remaining > 0 && b.expiresAt);
    if (active.length === 0) return null;
    active.sort((a: any, b: any) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
    const soonest = active[0];
    return { remaining: soonest.remaining, expiresAt: soonest.expiresAt };
  })();

  return (
    <div className="space-y-4">
      <Card
        title={`会员详情 · ${customer?.name}`}
        extra={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => nav('/member')}>返回列表</Button>
            <Button onClick={() => setShowAdj(true)}>调整余额/豆/积分</Button>
          </div>
        }
      >
        <div className="grid grid-cols-3 gap-4">
          <Block title="基本信息">
            <Row label="姓名" value={customer?.name} />
            <Row label="手机号" value={customer?.phone} />
            <Row label="生日/年龄" value={`${fmtDate(customer?.birthday)}${data.age != null ? ` / ${data.age}岁` : ''}`} />
            <Row label="住址" value={customer?.address || '—'} />
            <Row label="卡号" value={member?.cardNo} />
          </Block>
          <Block title="档位与积分（清晰分开）" tone="blue">
            <Row label="档位" value={<Badge tone="blue">{tier?.name}</Badge>} />
            <Row label="累计积分（决定档位）" value={<span className="font-semibold text-brand-700">{balances?.points ?? 0} 分</span>} />
            <Row label="豆（可花）" value={<span className="font-semibold text-emerald-700">{balances?.beans ?? 0} 豆</span>} />
            <Row label="卡内余额" value={<span className="font-semibold text-ink-900">{fmtCents(balances?.balanceCents)} 元</span>} />
            <Row label="成为会员" value={`${fmtDate(member?.registeredAt)} · ${Math.floor((Date.now() - new Date(member?.registeredAt).getTime()) / 86400000)}天`} />
          </Block>
          <Block title="登记信息">
            <Row label="登记人" value={member?.registeredByName} />
            <Row label="登记门店" value={member?.registeredStoreName} />
            <Row label="办理时间" value={fmtDateTime(member?.registeredAt)} />
            {expiryReminder && (
              <Row label="豆到期提醒" value={<span className="text-amber-700">有 {expiryReminder.remaining} 豆将于 {fmtDate(expiryReminder.expiresAt)} 到期</span>} />
            )}
          </Block>
        </div>
      </Card>

      <Card title="检查记录（关联客户身份，跨门店）">
        {exams?.length === 0 ? <EmptyState text="暂无检查记录" /> :
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-500">
              <tr className="border-b border-slate-200 text-left">
                <th className="py-2">时间</th><th>部门</th><th>金额</th><th>复查日期</th><th>状态</th><th>登记门店</th><th></th>
              </tr>
            </thead>
            <tbody>
              {exams.map((e: any) => (
                <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => nav(`/exam/${e.id}`)}>
                  <td className="py-2">{fmtDateTime(e.registeredAt)}</td>
                  <td>{e.dept === 'OPTICAL' ? '配镜部' : '眼科部'}</td>
                  <td>{fmtCents(e.baseAmount)} 元</td>
                  <td>{fmtDate(e.reviewDate)}</td>
                  <td><Badge tone={e.reviewStatus === 'REVIEWED' ? 'green' : e.reviewStatus === 'PENDING' ? 'amber' : 'slate'}>{statusLabel(e.reviewStatus)}</Badge></td>
                  <td>{e.registeredStoreName}</td>
                  <td className="text-brand-600">查看 →</td>
                </tr>
              ))}
            </tbody>
          </table>}
      </Card>

      <Card title="余额/豆/积分 变动明细（来源已标注）">
        {ledgers?.length === 0 ? <EmptyState text="暂无流水" /> :
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-500">
              <tr className="border-b border-slate-200 text-left">
                <th className="py-2">时间</th><th>字段</th><th>增减</th><th>原因</th><th>来源</th><th>操作人/门店</th>
              </tr>
            </thead>
            <tbody>
              {ledgers.slice(0, 100).map((l: any) => (
                <tr key={l.id} className="border-b border-slate-100">
                  <td className="py-2">{fmtDateTime(l.createdAt)}</td>
                  <td>{fieldLabel(l.field)}</td>
                  <td className={l.delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                    {l.delta >= 0 ? '+' : ''}{l.field === 'BALANCE' ? fmtCents(l.delta) : l.delta}
                  </td>
                  <td className="max-w-xs truncate">{l.reason}</td>
                  <td>{sourceLabel(l.source)}{l.refType ? ` · ${l.refType}` : ''}</td>
                  <td className="text-xs">{l.operatorName} / {l.storeName}</td>
                </tr>
              ))}
            </tbody>
          </table>}
      </Card>

      <Card title="代付使用记录（这张卡被他人代付过）">
        {usagePayments?.length === 0 ? <EmptyState text="暂无代付记录" /> :
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-500">
              <tr className="border-b border-slate-200 text-left">
                <th className="py-2">时间</th><th>抵扣余额</th><th>抵扣豆</th><th>实付现金</th><th>操作人</th><th>门店</th>
              </tr>
            </thead>
            <tbody>
              {usagePayments.map((p: any) => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="py-2">{fmtDateTime(p.createdAt)}</td>
                  <td>{fmtCents(p.balanceDeduct)}</td>
                  <td>{p.beansDeduct}</td>
                  <td>{fmtCents(p.cashPaid)}</td>
                  <td>{p.operatorName}</td>
                  <td>{p.storeName}</td>
                </tr>
              ))}
            </tbody>
          </table>}
      </Card>

      <Modal open={showAdj} onClose={() => setShowAdj(false)} title="调整余额/豆/积分（走 Ledger 增量记录，必须填备注）"
        footer={<>
          <Button variant="ghost" onClick={() => setShowAdj(false)}>取消</Button>
          <Button disabled={busy} onClick={submitAdj}>{busy ? '提交中…' : '提交'}</Button>
        </>}>
        <div className="space-y-3">
          <Field label="字段" required>
            <Select value={adj.field} onChange={(e) => setAdj((a) => ({ ...a, field: e.target.value }))}>
              {LEDGER_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
          </Field>
          <Field label="增减量（正=加，负=减）" required hint={adj.field === 'BALANCE' ? '单位元（如 100 或 -50）' : '单位豆/分（如 200 或 -100）'}>
            <Input type="number" value={adj.delta} onChange={(e) => setAdj((a) => ({ ...a, delta: e.target.value }))} />
          </Field>
          {adj.field === 'BALANCE' && parseFloat(adj.delta) > 0 && (
            <Field label="充值现金（元，可选）" hint="如果是充值，填入实际收到的现金金额，会记入营业额的现金池。直接赠送或修正则不填。">
              <Input type="number" value={adj.cashReceivedYuan} onChange={(e) => setAdj((a) => ({ ...a, cashReceivedYuan: e.target.value }))} placeholder="如 100" />
            </Field>
          )}
          <Field label="备注原因（必填）" required>
            <TextArea rows={2} value={adj.reason} onChange={(e) => setAdj((a) => ({ ...a, reason: e.target.value }))} placeholder="如：电话核实后修正断网期间误算的余额" />
          </Field>
          <Field label="操作人" required>
            <Select value={adj.operatorId} onChange={(e) => setAdj((a) => ({ ...a, operatorId: e.target.value }))}>
              <option value="">请选择</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
            </Select>
          </Field>
          {err && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
        </div>
      </Modal>
    </div>
  );
}

function Block({ title, children, tone }: { title: string; children: React.ReactNode; tone?: 'blue' }) {
  return (
    <div className={`rounded-md border p-3 ${tone === 'blue' ? 'border-brand-200 bg-brand-50/40' : 'border-slate-200'}`}>
      <div className="mb-2 text-xs font-semibold text-ink-700">{title}</div>
      <div className="space-y-1.5 text-sm">{children}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: any }) {
  return <div className="flex items-center justify-between"><span className="text-ink-500">{label}</span><span className="font-medium text-ink-900">{value ?? '—'}</span></div>;
}
function fieldLabel(f: string) { return { BALANCE: '卡内余额', BEANS: '豆', POINTS: '累计积分' }[f] || f; }
function sourceLabel(s: string) {
  return { INIT: '开卡', RECHARGE: '充值', CONSUME: '消费', AWARD: '奖励', EXPIRE: '过期', ADJUST: '调整' }[s] || s;
}
function statusLabel(s: string) {
  return { PENDING: '待复查', CONTACTED: '已联系', CONTACTED_NO_SHOW: '已联系不到店', REVIEWED: '已复查' }[s] || s;
}
