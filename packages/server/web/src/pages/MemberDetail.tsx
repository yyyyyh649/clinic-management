import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Card, Button, Badge, Modal, Field, Input, Select, TextArea, EmptyState, fmtDate, fmtDateTime, fmtCents } from '../components/ui';
import { PhoneInput, isPhoneValid } from '../components/PhoneInput';

const LEDGER_FIELDS = [
  { value: 'BALANCE', label: '卡内余额（元）' },
  { value: 'BEANS', label: '豆' },
  { value: 'POINTS', label: '累计积分' },
];

export default function MemberDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<any>(null);
  const [showAdj, setShowAdj] = useState(false);
  const [adj, setAdj] = useState({ field: 'BALANCE', delta: '', reason: '' });
  const [showEdit, setShowEdit] = useState(false);
  const [edit, setEdit] = useState({ name: '', phone: '', address: '', birthday: '', changePassword: '', reason: '' });
  const [usage, setUsage] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    if (!id) return;
    const r = await api.getMember(id);
    setData(r);
    setEdit({ name: r.customer?.name || '', phone: r.customer?.phone || '', address: r.customer?.address || '', birthday: r.customer?.birthday ? fmtDate(r.customer.birthday) : '', changePassword: '', reason: '' });
    api.listMemberUsage(id).then((u) => setUsage(u.items || []));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function submitAdj() {
    setErr('');
    if (!adj.delta || !adj.reason.trim()) { setErr('增减量和备注必填'); return; }
    setBusy(true);
    try {
      const cents = adj.field === 'BALANCE' ? Math.round(parseFloat(adj.delta) * 100) : parseInt(adj.delta, 10);
      await api.adjustLedger(id!, { field: adj.field, delta: cents, reason: adj.reason, operatorName: '后台' });
      setShowAdj(false);
      setAdj({ field: 'BALANCE', delta: '', reason: '' });
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function submitEdit() {
    setErr('');
    // B.8: no hardcoded password check on the client — the server verifies the
    // change-password against the DB hash. We only enforce that the phone format
    // is valid (C.1) and that the change-password is filled when the phone changes.
    if (edit.phone && !isPhoneValid(edit.phone)) { setErr('手机号格式错误（需11位、第一位为1）'); return; }
    if (edit.phone !== data.customer?.phone && !edit.changePassword) {
      setErr('修改手机号需要先输入敏感信息修改密码'); return;
    }
    setBusy(true);
    try {
      await api.updateMember(id!, {
        name: edit.name, phone: edit.phone, address: edit.address, birthday: edit.birthday || undefined,
        changePassword: edit.changePassword || undefined, reason: edit.reason || '后台修改',
        operatorName: '后台',
      });
      setShowEdit(false);
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!data) return <div className="text-sm text-ink-500">加载中…</div>;
  const { member, customer, balances, tier, exams, ledgers, beanBatches } = data;

  // B.5: replace the internal "可用豆批次" concept with a useful "最近到期提醒".
  const expiryReminder = (() => {
    const active = (beanBatches || []).filter((b: any) => !b.expired && b.remaining > 0 && b.expiresAt);
    if (active.length === 0) return null;
    active.sort((a: any, b: any) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
    const soonest = active[0];
    return { remaining: soonest.remaining, expiresAt: soonest.expiresAt };
  })();

  return (
    <div className="space-y-4">
      <Card title={`会员详情 · ${customer?.name}`} extra={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => nav('/members')}>返回</Button>
          <Button variant="ghost" onClick={() => setShowEdit(true)}>编辑信息</Button>
          <Button onClick={() => setShowAdj(true)}>调整余额/豆/积分</Button>
        </div>
      }>
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
            <Row label="成为会员" value={fmtDate(member?.registeredAt)} />
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

      <Card title="检查记录（跨门店）">
        {exams?.length === 0 ? <EmptyState text="暂无检查记录" /> :
          <table className="tbl">
            <thead className="text-xs text-ink-500">
              <tr>
                <th>时间</th><th>部门</th><th>金额</th><th>复查日期</th><th>状态</th><th>登记门店</th>
              </tr>
            </thead>
            <tbody>
              {exams.map((e: any) => (
                <tr key={e.id}>
                  <td>{fmtDateTime(e.registeredAt)}</td>
                  <td>{e.dept === 'OPTICAL' ? '配镜部' : '眼科部'}</td>
                  <td>{fmtCents(e.baseAmount)}</td>
                  <td>{fmtDate(e.reviewDate)}</td>
                  <td><Badge tone={e.reviewStatus === 'REVIEWED' ? 'green' : e.reviewStatus === 'PENDING' ? 'amber' : 'slate'}>{statusLabel(e.reviewStatus)}</Badge></td>
                  <td>{e.registeredStoreName}</td>
                </tr>
              ))}
            </tbody>
          </table>}
      </Card>

      <Card title="余额/豆/积分 变动明细">
        {ledgers?.length === 0 ? <EmptyState text="暂无流水" /> :
          <table className="tbl">
            <thead className="text-xs text-ink-500">
              <tr>
                <th>时间</th><th>字段</th><th>增减</th><th>原因</th><th>来源</th><th>操作人/门店</th>
              </tr>
            </thead>
            <tbody>
              {ledgers.slice(0, 100).map((l: any) => (
                <tr key={l.id}>
                  <td>{fmtDateTime(l.createdAt)}</td>
                  <td>{fieldLabel(l.field)}</td>
                  <td className={l.delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{l.delta >= 0 ? '+' : ''}{l.field === 'BALANCE' ? fmtCents(l.delta) : l.delta}</td>
                  <td className="max-w-xs truncate">{l.reason}</td>
                  <td>{sourceLabel(l.source)}{l.refType ? ` · ${l.refType}` : ''}</td>
                  <td className="text-xs">{l.operatorName} / {l.storeName}</td>
                </tr>
              ))}
            </tbody>
          </table>}
      </Card>

      <Card title="代付使用记录">
        {usage.length === 0 ? <EmptyState text="暂无代付记录" /> :
          <table className="tbl">
            <thead className="text-xs text-ink-500">
              <tr>
                <th>时间</th><th>抵扣余额</th><th>抵扣豆</th><th>实付现金</th><th>操作人</th><th>门店</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDateTime(p.createdAt)}</td>
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

      {/* 调整余额/豆/积分 (Ledger 增量) */}
      <Modal open={showAdj} onClose={() => setShowAdj(false)} title="调整余额/豆/积分（走 Ledger 增量记录，必须填备注，无需敏感信息密码）"
        footer={<><Button variant="ghost" onClick={() => setShowAdj(false)}>取消</Button><Button disabled={busy} onClick={submitAdj}>提交</Button></>}>
        <div className="space-y-3">
          <Field label="字段" required>
            <Select value={adj.field} onChange={(e) => setAdj((a) => ({ ...a, field: e.target.value }))}>
              {LEDGER_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
          </Field>
          <Field label="增减量（正=加，负=减）" required hint={adj.field === 'BALANCE' ? '单位元' : '单位豆/分'}>
            <Input type="number" value={adj.delta} onChange={(e) => setAdj((a) => ({ ...a, delta: e.target.value }))} />
          </Field>
          <Field label="备注原因（必填）" required>
            <TextArea rows={2} value={adj.reason} onChange={(e) => setAdj((a) => ({ ...a, reason: e.target.value }))} />
          </Field>
          {err && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
        </div>
      </Modal>

      {/* 编辑客户敏感信息（需敏感信息修改密码） */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="编辑客户信息（修改手机号需敏感信息修改密码 + 二次确认）"
        footer={<><Button variant="ghost" onClick={() => setShowEdit(false)}>取消</Button><Button disabled={busy} onClick={submitEdit}>提交</Button></>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="姓名"><Input value={edit.name} onChange={(e) => setEdit((s) => ({ ...s, name: e.target.value }))} /></Field>
            <Field label="手机号（修改需填下方密码）">
              <PhoneInput value={edit.phone} onChange={(e) => setEdit((s) => ({ ...s, phone: e.target.value }))} />
            </Field>
            <Field label="生日"><Input type="date" value={edit.birthday} onChange={(e) => setEdit((s) => ({ ...s, birthday: e.target.value }))} /></Field>
            <Field label="住址"><Input value={edit.address} onChange={(e) => setEdit((s) => ({ ...s, address: e.target.value }))} /></Field>
          </div>
          {edit.phone !== data.customer?.phone && (
            <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-700">
              您正在修改手机号，旧号将自动写入曾用手机号历史。修改后该客户名下所有历史检查记录会自动继续显示在详情页（关联 customer_id，不存手机号快照）。
            </div>
          )}
          <Field label="敏感信息修改密码（仅修改手机号时需要）" hint="所有密码不在前端明文展示">
            <Input type="password" value={edit.changePassword} onChange={(e) => setEdit((s) => ({ ...s, changePassword: e.target.value }))} />
          </Field>
          <Field label="修改原因"><TextArea rows={2} value={edit.reason} onChange={(e) => setEdit((s) => ({ ...s, reason: e.target.value }))} /></Field>
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
function sourceLabel(s: string) { return { INIT: '开卡', RECHARGE: '充值', CONSUME: '消费', AWARD: '奖励', EXPIRE: '过期', ADJUST: '调整' }[s] || s; }
function statusLabel(s: string) { return { PENDING: '待复查', CONTACTED: '已联系', CONTACTED_NO_SHOW: '已联系不到店', REVIEWED: '已复查' }[s] || s; }
