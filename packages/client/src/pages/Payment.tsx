// 支付页 (§4): discount, balance/beans deduction, manual cash edit + reason,
// offline prompt (§4.2), 代付 (§4.3), beans/points award + 归属 (§4.4).
//
// E: 支付不再单独选"操作人"——全程沿用检查登记时选的"登记人"作为本单支付及
//    其产生的全部余额/豆/积分流水的操作人。充值例外（仍单独选操作人，见会员详情）。
// B.4: 实付金额/获得豆/积分均为预填数值（可直接确认或改），删除"手动修改"勾选框，
//    改动判断完全交给系统自动比对。
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, isElectron } from '../api';
import { useSyncStatus } from '../hooks/useApp';
import { Button, Card, Field, Input, Select, Modal, Badge, fmtCents, parseYuanToCents } from '../components/ui';

interface PaymentConfig {
  discountType: '' | 'PERCENT' | 'MINUS';
  discountValue: string;
  balanceDeduct: string;
  beansDeduct: string;
  payForMemberId: string;
  cashPaid: string;
  editReason: string;
  beansAwarded: string;
  pointsAwarded: string;
  awardMemberId: string;
}

const empty: PaymentConfig = {
  discountType: '', discountValue: '', balanceDeduct: '', beansDeduct: '',
  payForMemberId: '', cashPaid: '', editReason: '',
  beansAwarded: '', pointsAwarded: '', awardMemberId: '',
};

export default function Payment() {
  const { examId } = useParams();
  const nav = useNavigate();
  const sync = useSyncStatus();
  const [exam, setExam] = useState<any>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const [cfg, setCfg] = useState<PaymentConfig>(empty);
  // touched flags: once the user edits a prefilled field, stop auto-syncing it.
  const [touched, setTouched] = useState({ cash: false, beans: false, points: false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [showSearch, setShowSearch] = useState(false);

  // payForMember: full member object (with balances) currently selected as the card source.
  const [payForMember, setPayForMember] = useState<any>(null);
  // useCard: whether to use a member card for deduction. Default true if customer is a member.
  const [useCard, setUseCard] = useState(true);

  useEffect(() => {
    if (!examId) return;
    api.getExam(examId).then(async (r: any) => {
      setExam(r.exam);
      // If the underlying customer is a member, preselect them as payFor + load balances.
      if (r.customer?.isMember && r.customer?.memberId) {
        setCfg((c) => ({ ...c, payForMemberId: r.customer.memberId }));
        try {
          const detail = await api.getMember(r.customer.memberId);
          setPayForMember(detail);
        } catch { /* ignore */ }
      }
    });
    api.getStaff().then((s: any) => setStaff(s || []));
  }, [examId]);

  // The registrar (登记人) — the single operator for the whole transaction (E).
  const registrar = exam ? staff.find((s) => s.id === exam.registeredBy) : null;
  // 归属默认：登记人是会员 -> 归登记人本人；否则需选择其他会员。
  useEffect(() => {
    if (registrar?.isMember && registrar.memberId && !cfg.awardMemberId) {
      setCfg((c) => ({ ...c, awardMemberId: registrar.memberId! }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrar]);

  // ---- computed amounts ----
  const baseAmount = exam?.baseAmount || 0;
  const afterDiscount = useMemo(() => {
    if (cfg.discountType === 'PERCENT' && cfg.discountValue) {
      const v = parseFloat(cfg.discountValue);
      if (!Number.isNaN(v)) return Math.round((baseAmount * v) / 100);
    } else if (cfg.discountType === 'MINUS' && cfg.discountValue) {
      const v = parseYuanToCents(cfg.discountValue);
      return Math.max(0, baseAmount - v);
    }
    return baseAmount;
  }, [baseAmount, cfg.discountType, cfg.discountValue]);

  const balanceDeductCents = cfg.balanceDeduct ? parseYuanToCents(cfg.balanceDeduct) : 0;
  const beansDeductCount = cfg.beansDeduct ? parseInt(cfg.beansDeduct, 10) || 0 : 0;
  const beansDeductAmount = beansDeductCount; // 1豆 = 1分
  const expectedCash = Math.max(0, afterDiscount - balanceDeductCents - beansDeductAmount);

  // Card balance / beans (for display + overage detection).
  const cardBalanceCents = payForMember?.balances?.balanceCents ?? 0;
  // 豆显示/校验必须用 spendableBeans（已扣除过期批次），而非 balances.beans（原始累计）。
  // 否则一旦启用豆有效期且有豆已过期，前台会显示/允许输入实际不可用的豆数。
  const cardBeans = payForMember?.balances?.spendableBeans ?? 0;
  const cardPoints = payForMember?.balances?.points ?? 0;
  const balanceOverage = useCard && balanceDeductCents > cardBalanceCents;
  const beansOverage = useCard && beansDeductCount > cardBeans;
  // "全部抵扣" helpers: cap at remaining amount, never go negative.
  const remainingAfterBeans = Math.max(0, afterDiscount - beansDeductAmount);
  const maxBalanceDeduct = Math.min(cardBalanceCents, remainingAfterBeans) / 100; // 元
  const maxBeansDeduct = Math.min(cardBeans, Math.floor(afterDiscount / 100) * 100); // 整百

  // Prefill 实付现金 with the system-calculated value (B.4) until the user edits it.
  useEffect(() => {
    if (!touched.cash) setCfg((c) => ({ ...c, cashPaid: fmtCents(expectedCash) }));
  }, [expectedCash, touched.cash]);

  const cashPaidCents = cfg.cashPaid ? parseYuanToCents(cfg.cashPaid) : 0;
  const cashMismatch = cashPaidCents !== expectedCash;
  const needsReason = cashMismatch && !cfg.editReason.trim();

  const defaultBeansAwarded = Math.floor(cashPaidCents / 100);
  // Prefill 获得豆/累计积分 with defaults (B.4) until the user edits them.
  useEffect(() => {
    if (!touched.beans) setCfg((c) => ({ ...c, beansAwarded: String(defaultBeansAwarded) }));
  }, [defaultBeansAwarded, touched.beans]);
  useEffect(() => {
    if (!touched.points) {
      const b = cfg.beansAwarded === '' ? defaultBeansAwarded : (parseInt(cfg.beansAwarded, 10) || 0);
      setCfg((c) => ({ ...c, pointsAwarded: String(b) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.beansAwarded, defaultBeansAwarded, touched.points]);

  const beansAwarded = cfg.beansAwarded === '' ? defaultBeansAwarded : (parseInt(cfg.beansAwarded, 10) || 0);
  const pointsAwarded = cfg.pointsAwarded === '' ? beansAwarded : (parseInt(cfg.pointsAwarded, 10) || 0);

  function set<K extends keyof PaymentConfig>(k: K, v: PaymentConfig[K]) {
    setCfg((c) => ({ ...c, [k]: v }));
  }

  // ---- 代付 member search ----
  async function runSearch() {
    if (!searchQ.trim()) { setSearchResults([]); return; }
    try {
      const r = await api.searchMembers(searchQ, false);
      setSearchResults(r.items || []);
    } catch { setSearchResults([]); }
  }
  function pickPayFor(m: any) {
    set('payForMemberId', m.id);
    setPayForMember(m); // 保存完整对象（含 balances）用于显示
    setShowSearch(false);
    setSearchQ('');
    setSearchResults([]);
  }

  async function submit() {
    setErr('');
    if (useCard && (balanceDeductCents > 0 || beansDeductCount > 0) && !cfg.payForMemberId) {
      setErr('使用余额/豆抵扣需选择会员卡'); return;
    }
    if (balanceOverage) { setErr(`余额超额：卡内仅剩 ${fmtCents(cardBalanceCents)} 元，无法抵扣 ${fmtCents(balanceDeductCents)} 元`); return; }
    if (beansOverage) { setErr(`豆超额：卡内仅剩 ${cardBeans} 豆，无法抵扣 ${beansDeductCount} 豆`); return; }
    if (beansDeductCount > 0 && beansDeductCount % 100 !== 0) { setErr('豆抵现必须整百使用'); return; }
    if (cashMismatch && !cfg.editReason.trim()) { setErr('实付金额与系统计算不一致，必须填写修改原因'); return; }
    if ((beansAwarded > 0 || pointsAwarded > 0) && !cfg.awardMemberId) { setErr('登记人不是会员或未选择归属会员，无法发放豆/积分'); return; }

    setBusy(true);
    try {
      // E: no operator is sent — the server derives it from exam.registeredBy.
      const res = await api.createPayment({
        examId,
        discountType: cfg.discountType || undefined,
        discountValue: cfg.discountType === 'PERCENT' ? parseFloat(cfg.discountValue || '0') : (cfg.discountType === 'MINUS' ? parseYuanToCents(cfg.discountValue) : undefined),
        balanceDeductCents,
        beansDeductCount,
        payForMemberId: cfg.payForMemberId || undefined,
        cashPaidCents,
        cashPaidEdited: cashMismatch, // auto-detected by the system (B.4)
        editReason: cfg.editReason || undefined,
        beansAwardedOverride: cfg.beansAwarded === '' ? undefined : beansAwarded,
        pointsAwardedOverride: cfg.pointsAwarded === '' ? undefined : pointsAwarded,
        awardMemberId: cfg.awardMemberId || undefined,
      });
      setDone(res);
    } catch (e: any) {
      setErr(e.message || '支付失败');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card title="支付成功" extra={<Badge tone="green">已完成</Badge>}>
          <div className="space-y-2 text-sm">
            <Row label="应付基础" value={`${fmtCents(done.baseAmount)} 元`} />
            <Row label="折后应付" value={`${fmtCents(done.afterDiscount)} 元`} />
            <Row label="应实付现金" value={`${fmtCents(done.expectedCashPaid)} 元`} />
            <Row label="获得豆" value={`${done.beansAwarded} 豆（同步进累计积分 ${done.pointsAwarded} 分）`} />
            <Row label="操作人（登记人）" value={exam?.registeredByName || '—'} />
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => nav('/exam')}>查看检查列表</Button>
            <Button variant="ghost" onClick={() => nav('/exam/register')}>再登记一例</Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!exam) return <div className="p-6 text-sm text-ink-500">加载检查记录…</div>;

  const deptLabel = exam.dept === 'OPTICAL' ? '配镜部' : '眼科部';
  const offline = isElectron && !sync.online;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Card title={`支付 · ${deptLabel}`} extra={<Badge tone="blue">{exam.customer?.name} · {exam.customer?.phone}</Badge>}>
        {/* Offline warning is prominent + persistent per §4.2 */}
        {offline && (
          <div className="mb-4 rounded-md border-2 border-rose-300 bg-rose-50 px-4 py-3">
            <div className="text-sm font-semibold text-rose-700">⚠ 当前网络异常（离线模式）</div>
            <div className="mt-1 text-xs text-rose-700">
              存在别的设备/门店同时读取到旧余额数据、导致这个会员被超额消费的风险。
              建议尽量避免让客户在此时使用余额/豆；如果客人坚持要用，建议先打电话跟另一家店核实余额还够不够。
            </div>
          </div>
        )}

        <div className="space-y-5">
          {/* Base amount */}
          <div className="rounded-md bg-slate-50 p-3">
            {exam.dept === 'OPTICAL' ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Row label="镜片" value={`${exam.lensBrand || '—'} ${fmtCents(exam.lensPrice)}元`} />
                <Row label="镜架" value={`${exam.frameBrand || '—'} ${fmtCents(exam.framePrice)}元`} />
              </div>
            ) : (
              <div className="text-sm"><Row label="总金额" value={`${fmtCents(exam.totalAmount)} 元`} /></div>
            )}
            <div className="mt-2 border-t border-slate-200 pt-2 text-right text-sm">
              <span className="text-ink-500">应付基础：</span>
              <span className="text-base font-semibold text-ink-900">{fmtCents(baseAmount)} 元</span>
            </div>
          </div>

          {/* Operator (read-only, = 登记人, spec E) */}
          <div className="rounded-md bg-brand-50/60 px-3 py-2 text-sm">
            <Row label="操作人（沿用登记人）" value={exam.registeredByName || '—'} />
            <div className="mt-1 text-xs text-ink-500">本单从登记到支付由同一人完成，操作人即检查登记时所选登记人，无需再选。</div>
          </div>

          {/* Discount */}
          <div className="grid grid-cols-3 gap-3 items-end">
            <Field label="店内活动">
              <Select value={cfg.discountType} onChange={(e) => set('discountType', e.target.value as any)}>
                <option value="">无</option>
                <option value="PERCENT">折扣（如85=85折）</option>
                <option value="MINUS">立减（元）</option>
              </Select>
            </Field>
            <Field label={cfg.discountType === 'PERCENT' ? '折扣值（%）' : cfg.discountType === 'MINUS' ? '立减金额（元）' : '数值'}>
              <Input
                type="number"
                value={cfg.discountValue}
                disabled={!cfg.discountType}
                onChange={(e) => set('discountValue', e.target.value)}
                placeholder={cfg.discountType === 'PERCENT' ? '如 85' : '如 50'}
              />
            </Field>
            <div className="text-right text-sm">
              <span className="text-ink-500">折后应付：</span>
              <span className="font-semibold text-brand-700">{fmtCents(afterDiscount)} 元</span>
            </div>
          </div>

          {/* Member card selection (use / not use + which card) */}
          <div className="rounded-md border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold text-ink-700">会员卡抵扣</div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={useCard} onChange={(e) => setUseCard(e.target.checked)} />
                使用会员卡
              </label>
            </div>

            {useCard && (
              <>
                {/* Selected card info + switch/search */}
                <div className="mb-3 rounded-md bg-brand-50 p-3">
                  {payForMember ? (
                    <div className="flex items-center justify-between">
                      <div className="text-sm">
                        <div className="font-medium text-ink-900">{payForMember.customer?.name} · 卡号 {payForMember.member?.cardNo || payForMember.cardNo}</div>
                        <div className="mt-1 flex gap-4 text-xs text-ink-600">
                          <span>余额：<b className="text-brand-700">{fmtCents(cardBalanceCents)} 元</b></span>
                          <span>豆：<b className="text-brand-700">{cardBeans}</b></span>
                          <span>累计积分：<b className="text-brand-700">{cardPoints}</b></span>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setShowSearch(true)}>切换会员卡</Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ink-500">本客户不是会员，请搜索其他会员卡</span>
                      <Button size="sm" onClick={() => setShowSearch(true)}>搜索会员卡</Button>
                    </div>
                  )}
                </div>

                {/* Deduction inputs with overage red + 全部抵扣 */}
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="卡内余额抵扣（元）"
                    error={balanceOverage ? `超额！卡内仅剩 ${fmtCents(cardBalanceCents)} 元` : undefined}
                  >
                    <div className="flex gap-1">
                      <Input
                        type="number"
                        value={cfg.balanceDeduct}
                        onChange={(e) => set('balanceDeduct', e.target.value)}
                        placeholder="如 800"
                        className={balanceOverage ? 'border-rose-500' : ''}
                      />
                      <Button size="sm" variant="ghost" onClick={() => set('balanceDeduct', String(maxBalanceDeduct))}>全部抵扣</Button>
                    </div>
                  </Field>
                  <Field
                    label="豆抵扣数量（须整百，100豆=1元）"
                    error={beansOverage ? `超额！卡内仅剩 ${cardBeans} 豆` : undefined}
                  >
                    <div className="flex gap-1">
                      <Input
                        type="number"
                        value={cfg.beansDeduct}
                        onChange={(e) => set('beansDeduct', e.target.value)}
                        placeholder="如 500"
                        className={beansOverage ? 'border-rose-500' : ''}
                      />
                      <Button size="sm" variant="ghost" onClick={() => set('beansDeduct', String(maxBeansDeduct))}>全部抵扣</Button>
                    </div>
                  </Field>
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div className="text-xs text-ink-500">
                    抵扣金额合计：{fmtCents(balanceDeductCents + beansDeductAmount)} 元
                  </div>
                  <div className="text-right text-sm">
                    <span className="text-ink-500">应实付现金：</span>
                    <span className="font-semibold text-brand-700">{fmtCents(expectedCash)} 元</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Cash payment (prefilled, editable; auto-detect manual change — B.4) */}
          <div className="rounded-md border border-slate-200 p-3">
            <div className="mb-2 text-xs font-semibold text-ink-700">现金支付</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="实付现金（元）" required>
                <Input
                  type="number"
                  value={cfg.cashPaid}
                  onChange={(e) => { setTouched((t) => ({ ...t, cash: true })); set('cashPaid', e.target.value); }}
                />
              </Field>
              <Field label="修改原因（实付与系统计算不一致时必填）" error={needsReason ? '实付与计算不符，必须填写原因' : undefined}>
                <Input value={cfg.editReason} onChange={(e) => set('editReason', e.target.value)} disabled={!cashMismatch} placeholder={!cashMismatch ? '一致，无需填写' : '如：客户抹零 / 凑整数'} />
              </Field>
            </div>
            {cashMismatch && (
              <div className="mt-2 text-xs text-amber-700">实付金额与系统计算（{fmtCents(expectedCash)} 元）不一致，系统将记录为手动修改。</div>
            )}
          </div>

          {/* Awards + 归属 (prefilled, editable — B.4) */}
          {cashPaidCents > 0 && (
            <div className="rounded-md border border-slate-200 p-3">
              <div className="mb-2 text-xs font-semibold text-ink-700">豆 / 累计积分 奖励（按 1元=1豆）</div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="获得豆（可改）">
                  <Input type="number" value={cfg.beansAwarded} onChange={(e) => { setTouched((t) => ({ ...t, beans: true })); set('beansAwarded', e.target.value); }} />
                </Field>
                <Field label="累计积分（可改）">
                  <Input type="number" value={cfg.pointsAwarded} onChange={(e) => { setTouched((t) => ({ ...t, points: true })); set('pointsAwarded', e.target.value); }} />
                </Field>
                <Field label="归属会员" error={!cfg.awardMemberId ? '登记人不是会员，请选择归属会员' : undefined}>
                  <Select value={cfg.awardMemberId} onChange={(e) => set('awardMemberId', e.target.value)}>
                    <option value="">请选择</option>
                    {registrar?.isMember && registrar.memberId && <option value={registrar.memberId}>{exam.registeredByName} · 登记人本人</option>}
                    {searchResults.filter((m) => !registrar || m.id !== registrar.memberId).map((m) => <option key={m.id} value={m.id}>{m.customer?.name} · {m.cardNo}</option>)}
                    {exam.customer?.isMember && (!registrar || exam.customer.memberId !== registrar.memberId) && <option value={exam.customer.memberId}>{exam.customer.name} · 本客户</option>}
                  </Select>
                </Field>
              </div>
              <div className="mt-2 text-xs text-ink-500">
                提示：登记人是会员默认归属登记人本人；不是会员必须选其他会员。点击下方按钮搜索其他会员。
                <Button size="sm" variant="ghost" className="ml-2" onClick={() => setShowSearch(true)}>搜索会员</Button>
              </div>
            </div>
          )}

          {err && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => nav(-1)}>取消</Button>
            <Button disabled={busy || needsReason} onClick={submit}>{busy ? '提交中…' : '完成支付'}</Button>
          </div>
        </div>
      </Card>

      {/* 代付/归属 搜索模态 */}
      <Modal open={showSearch} onClose={() => setShowSearch(false)} title="搜索会员（全连锁共享）">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="姓名 / 手机号 / 卡号后四位 / 完整卡号" />
            <Button onClick={runSearch}>搜索</Button>
          </div>
          <div className="space-y-2">
            {searchResults.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{m.customer?.name} · {m.customer?.phone}</div>
                  <div className="text-xs text-ink-500">卡号 {m.cardNo}</div>
                </div>
                <Button size="sm" onClick={() => { pickPayFor(m); setCfg((c) => ({ ...c, awardMemberId: m.id })); }}>确认身份并使用</Button>
              </div>
            ))}
            {searchResults.length === 0 && <div className="py-4 text-center text-xs text-ink-500">输入条件后点击搜索</div>}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-500">{label}</span>
      <span className="font-medium text-ink-900">{value ?? '—'}</span>
    </div>
  );
}
