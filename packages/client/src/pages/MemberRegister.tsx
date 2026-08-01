// 会员登记 (§3.1): customer dedup + member fields + init balance/beans.
// C.1: phone uses PhoneInput (realtime validation). C.2: birthday defaults to yesterday (不能选今天及以后).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Button, Card, Field, Input, Modal, Badge, fmtCents, parseYuanToCents } from '../components/ui';
import { PhoneInput, isPhoneValid } from '../components/PhoneInput';

const todayStr = () => new Date().toISOString().slice(0, 10);
const yesterdayStr = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };

export default function MemberRegister() {
  const nav = useNavigate();
  const [staff, setStaff] = useState<any[]>([]);
  const [tiers, setTiers] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: '', phone: '', cardNo: '', birthday: yesterdayStr(), address: '',
    registeredById: '', initialBalance: '', initialBeans: '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<any[] | null>(null);
  const [reuseCustomerId, setReuseCustomerId] = useState<string | null>(null);
  const [reuseHint, setReuseHint] = useState<string>('');
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    api.getStaff().then((s: any) => setStaff(s || []));
    api.getTiers().then((t: any) => setTiers(t || []));
  }, []);

  function set<K extends keyof typeof form>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  // Phone-based customer dedup — re-run whenever the phone becomes a valid 11-digit number.
  async function checkPhone(phone: string) {
    if (!phone || !isPhoneValid(phone)) { setReuseCustomerId(null); setReuseHint(''); setConflict(null); return; }
    try {
      const r = await api.dedupCustomer(phone, form.name);
      if (r.found && r.mode === 'reuse') {
        setReuseCustomerId(r.customer.id);
        setReuseHint(`已匹配到客户「${r.customer.name}」(${r.customer.phone})，将复用此客户身份，历史检查记录会自动并入。`);
        setConflict(null);
      } else if (r.found && r.mode === 'conflict') {
        setConflict(r.customers);
        setReuseCustomerId(null);
        setReuseHint('');
      } else {
        setReuseCustomerId(null);
        setReuseHint('');
        setConflict(null);
      }
    } catch { /* ignore */ }
  }

  function resolveConflict(same: boolean, customer?: any) {
    if (same && customer) {
      setReuseCustomerId(customer.id);
      setReuseHint(`已选择复用客户「${customer.name}」(${customer.phone})。`);
    } else {
      setReuseCustomerId(null);
      setReuseHint('将创建新客户身份（同手机号挂多个客户）。');
    }
    setConflict(null);
  }

  async function submit() {
    setErr('');
    if (!form.name || !form.phone || !form.cardNo || !form.birthday || !form.registeredById) {
      setErr('姓名、手机号、卡号、生日、登记人必填'); return;
    }
    if (!isPhoneValid(form.phone)) { setErr('手机号格式错误（需11位、第一位为1）'); return; }
    setBusy(true);
    try {
      const staffObj = staff.find((s) => s.id === form.registeredById);
      const r = await api.registerMember({
        name: form.name, phone: form.phone, cardNo: form.cardNo,
        birthday: form.birthday, address: form.address || undefined,
        registeredById: form.registeredById,
        registeredByName: staffObj?.name || '',
        initialBalanceCents: form.initialBalance ? parseYuanToCents(form.initialBalance) : 0,
        initialBeans: form.initialBeans ? parseInt(form.initialBeans, 10) || 0 : 0,
        customerId: reuseCustomerId || undefined,
      });
      setResult(r);
    } catch (e: any) {
      setErr(e.message || '登记失败');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card title="会员登记成功" extra={<Badge tone="green">已完成</Badge>}>
          <div className="space-y-3">
            <Row label="客户姓名" value={result.customer?.name} />
            <Row label="手机号" value={result.customer?.phone} />
            <Row label="会员卡号" value={result.member?.cardNo} />
            <Row label="档位" value={result.tier?.name} />
            <Row label="累计积分" value={`${result.balances?.points ?? 0} 分`} />
            <Row label="卡内豆" value={`${result.balances?.spendableBeans ?? 0} 豆`} />
            <Row label="卡内余额" value={`${fmtCents(result.balances?.balanceCents)} 元`} />
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => nav(`/member/${result.member.id}`)}>查看会员详情</Button>
            <Button variant="ghost" onClick={() => { setResult(null); setForm({ name: '', phone: '', cardNo: '', birthday: yesterdayStr(), address: '', registeredById: '', initialBalance: '', initialBeans: '' }); setReuseCustomerId(null); setReuseHint(''); }}>继续登记下一个</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card title="会员登记" extra={<span className="text-xs text-ink-500">办理日期自动记录到秒，自动带上当前设备门店</span>}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="姓名" required>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="手机号" required>
            <PhoneInput
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              onValidChange={(p) => checkPhone(p)}
            />
          </Field>
          <Field label="会员卡号" required>
            <Input value={form.cardNo} onChange={(e) => set('cardNo', e.target.value)} />
          </Field>
          <Field label="生日" required hint="不能选今天及以后">
            <Input type="date" max={todayStr()} value={form.birthday} onChange={(e) => set('birthday', e.target.value)} />
          </Field>
          <Field label="住址（可选）">
            <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="登记人" required hint="任何店员，不分部门">
            <select className="input" value={form.registeredById} onChange={(e) => set('registeredById', e.target.value)}>
              <option value="">请选择</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
            </select>
          </Field>
          <Field label="初始余额（元，可选）">
            <Input type="number" value={form.initialBalance} onChange={(e) => set('initialBalance', e.target.value)} />
          </Field>
          <Field label="初始豆（可选）">
            <Input type="number" value={form.initialBeans} onChange={(e) => set('initialBeans', e.target.value)} />
          </Field>
        </div>

        {reuseHint && (
          <div className="mt-3 rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-700">{reuseHint}</div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-ink-500">档位由累计积分自动计算（当前最低档：{tiers[0]?.name || '普通会员'}）</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => nav(-1)}>取消</Button>
            <Button disabled={busy} onClick={submit}>{busy ? '提交中…' : '提交'}</Button>
          </div>
        </div>
        {err && <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
      </Card>

      <Modal
        open={!!conflict}
        title="该手机号下已有别的姓名记录"
        footer={
          <>
            <Button variant="ghost" onClick={() => resolveConflict(false)}>不是同一个人</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-ink-700">这个手机号下已经有别的姓名记录了，是同一个人吗？选「是」将复用所选客户身份，选「不是」将按手机号相同、但建一个新的客户身份（同一个手机号允许挂多个客户）。</p>
        <div className="space-y-2">
          {conflict?.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
              <div>
                <div className="text-sm font-medium">{c.name}</div>
                <div className="text-xs text-ink-500">{c.phone} {c.isMember ? '· 已是会员' : ''}</div>
              </div>
              <Button size="sm" onClick={() => resolveConflict(true, c)}>是同一个人</Button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm">
      <span className="text-ink-500">{label}</span>
      <span className="font-medium text-ink-900">{value ?? '—'}</span>
    </div>
  );
}
