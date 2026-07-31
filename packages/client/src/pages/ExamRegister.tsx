// 检查登记 (§3.2): customer info → dept template → content → review → 跳支付.
// C.1: phone uses PhoneInput (realtime validation).
// C.2: birthday defaults to today.
// C.5: 复查记录人 removed — only 登记人 remains.
// C.6: review is "days from now" input, auto-computes the review date.
// B.9: 登记人 dropdown limited to staff in the selected dept.
import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Button, Card, Field, Input, Select, TextArea, fmtCents } from '../components/ui';
import { PhoneInput, isPhoneValid } from '../components/PhoneInput';
import { DEFAULT_REVIEW_DAYS } from '@clinic/shared';

const todayStr = () => new Date().toISOString().slice(0, 10);
const addDaysStr = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

interface Page {
  title: string;
  questions: { id: string; type: 'FILL' | 'CHOICE'; title: string; required?: boolean; options?: string[]; other?: boolean }[];
}

export default function ExamRegister() {
  const nav = useNavigate();
  const [staff, setStaff] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState({
    name: '', phone: '', birthday: todayStr(), address: '',
    customerId: '', existingMember: null as any,
  });
  const [dept, setDept] = useState<'OPTICAL' | 'EYE'>('OPTICAL');
  const [templateId, setTemplateId] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [optical, setOptical] = useState({ lensBrand: '', lensPrice: '', frameBrand: '', framePrice: '' });
  const [eyeTotal, setEyeTotal] = useState('');
  // C.6: review is "N days from now" (default 90), the date is computed & shown read-only.
  const [reviewDays, setReviewDays] = useState<string>(String(DEFAULT_REVIEW_DAYS));
  const [reviewNote, setReviewNote] = useState('');
  const [registeredById, setRegisteredById] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dedupMsg, setDedupMsg] = useState('');

  useEffect(() => {
    api.getStaff().then((s: any) => setStaff(s || []));
    api.getBrands().then((b: any) => setBrands(b || []));
  }, []);

  // Templates filtered by dept. C.5/B.9: 登记人 also limited to current dept.
  useEffect(() => {
    api.getTemplates(dept).then((t: any) => { setTemplates(t || []); setTemplateId(''); setAnswers({}); });
    // B.9: if the current 登记人 isn't in the new dept's staff list, clear it.
    setRegisteredById((cur) => {
      const stillValid = staff.some((s) => s.id === cur && s.depts?.split(',').map((d: string) => d.trim()).includes(dept));
      return stillValid ? cur : '';
    });
  }, [dept, staff]);
  // C.5: registrar candidates limited to the selected dept (was reviewerCandidates).
  const registrarCandidates = useMemo(
    () => staff.filter((s) => (s.depts || '').split(',').map((d: string) => d.trim()).includes(dept)),
    [staff, dept],
  );

  const tpl = templates.find((t) => t.id === templateId);
  const tplPages: Page[] = tpl?.pages || [];

  // Computed review date from the days input (C.6).
  const reviewDaysNum = parseInt(reviewDays, 10);
  const computedReviewDate = Number.isNaN(reviewDaysNum) ? '' : addDaysStr(reviewDaysNum);

  async function checkPhone(phone: string) {
    if (!phone || !isPhoneValid(phone)) { setDedupMsg(''); setForm((f) => ({ ...f, existingMember: null, customerId: '' })); return; }
    try {
      const r = await api.dedupCustomer(phone, form.name);
      if (r.found && r.mode === 'reuse') {
        setForm((f) => ({ ...f, customerId: r.customer.id, existingMember: r.customer }));
        setDedupMsg(`已匹配客户「${r.customer.name}」，将复用此客户身份。${r.customer.isMember ? '已是会员。' : '尚未办理会员。'}`);
      } else if (r.found && r.mode === 'conflict') {
        setForm((f) => ({ ...f, customerId: '', existingMember: null }));
        setDedupMsg(`手机号下有别的姓名记录（${r.customers.length} 个），将创建新客户身份。`);
      } else {
        setForm((f) => ({ ...f, customerId: '', existingMember: null }));
        setDedupMsg('');
      }
    } catch { /* ignore */ }
  }

  function next1() {
    if (!form.name || !form.phone) { setErr('姓名和手机号必填'); return; }
    if (!isPhoneValid(form.phone)) { setErr('手机号格式错误（需11位、第一位为1）'); return; }
    setErr(''); setStep(2);
  }

  function next2() {
    if (dept === 'OPTICAL' && (!optical.lensPrice || !optical.framePrice)) { setErr('配镜部镜片价格、镜架价格必填'); return; }
    if (dept === 'EYE' && !eyeTotal) { setErr('眼科部总金额必填'); return; }
    setErr(''); setStep(3);
  }

  async function submit() {
    if (!registeredById) { setErr('请选择登记人'); return; }
    if (!reviewDays.trim() || Number.isNaN(reviewDaysNum)) { setErr('请填写复查天数'); return; }
    setErr(''); setBusy(true);
    try {
      const reg = staff.find((s) => s.id === registeredById);
      const exam = await api.createExam({
        customerId: form.customerId || undefined,
        name: form.name, phone: form.phone, address: form.address || undefined,
        birthday: form.birthday || undefined,
        dept,
        templateId: templateId || undefined,
        templateName: tpl?.name,
        // content stores template + answers together so the detail page can render fully.
        content: tplPages.length ? { template: tplPages, answers } : undefined,
        lensBrand: dept === 'OPTICAL' ? optical.lensBrand || undefined : undefined,
        lensPrice: dept === 'OPTICAL' ? Math.round(parseFloat(optical.lensPrice || '0') * 100) : undefined,
        frameBrand: dept === 'OPTICAL' ? optical.frameBrand || undefined : undefined,
        framePrice: dept === 'OPTICAL' ? Math.round(parseFloat(optical.framePrice || '0') * 100) : undefined,
        totalAmount: dept === 'EYE' ? Math.round(parseFloat(eyeTotal) * 100) : undefined,
        reviewDate: computedReviewDate, // C.6: derived from days input
        reviewNote: reviewNote || undefined,
        registeredById, registeredByName: reg?.name || '',
      });
      nav(`/payment/${exam.id}`);
    } catch (e: any) {
      setErr(e.message || '提交失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Card title="检查登记" extra={<Stepper step={step} />}>
        {/* Step 1: customer info */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="姓名" required>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </Field>
              <Field label="手机号" required>
                <PhoneInput
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  onValidChange={(p) => checkPhone(p)}
                />
              </Field>
              <Field label="生日（可选）" hint="用于自动计算年龄">
                <Input type="date" value={form.birthday} onChange={(e) => setForm((f) => ({ ...f, birthday: e.target.value }))} />
              </Field>
              <Field label="住址（可选）">
                <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              </Field>
            </div>
            {dedupMsg && <div className="rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-700">{dedupMsg}</div>}
            {form.existingMember?.isMember && (
              <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                <span>该客户已是会员。</span>
                <Button size="sm" variant="ghost" onClick={() => nav(`/member/${form.existingMember.memberId}`)}>查看会员详情</Button>
              </div>
            )}
            {form.existingMember && !form.existingMember.isMember && (
              <div className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <span>该客户尚未办理会员。</span>
                <Button size="sm" variant="ghost" onClick={() => nav('/member/register')}>去办会员</Button>
              </div>
            )}
            {err && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
            <div className="flex justify-end">
              <Button onClick={next1}>下一步：选模板</Button>
            </div>
          </div>
        )}

        {/* Step 2: dept + template + content + amounts */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="部门" required>
                <Select value={dept} onChange={(e) => setDept(e.target.value as any)}>
                  <option value="OPTICAL">配镜部</option>
                  <option value="EYE">眼科部</option>
                </Select>
              </Field>
              <Field label="检查模板" hint={`可选；该部门模板共 ${templates.length} 个`}>
                <Select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setAnswers({}); }}>
                  <option value="">不使用模板</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
            </div>

            {tplPages.length > 0 && (
              <div className="space-y-4">
                {tplPages.map((p, pi) => (
                  <div key={pi} className="rounded-md border border-slate-200 p-3">
                    <div className="mb-2 text-xs font-semibold text-ink-700">{pi + 1}. {p.title}</div>
                    <div className="space-y-3">
                      {p.questions.map((q) => (
                        <div key={q.id}>
                          <div className="label">{q.title} {q.required && <span className="text-rose-500">*</span>}</div>
                          {q.type === 'FILL' ? (
                            <Input value={answers[q.id] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
                          ) : (
                            <Select value={answers[q.id] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}>
                              <option value="">请选择</option>
                              {q.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                              <option value="__other">其他（手填）</option>
                            </Select>
                          )}
                          {answers[q.id] === '__other' && (
                            <Input className="mt-2" placeholder="请填写其他内容" value={answers[`${q.id}__text`] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [`${q.id}__text`]: e.target.value }))} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {dept === 'OPTICAL' ? (
              <div className="grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-3">
                <Field label="镜片品牌（可选）">
                  <Select value={optical.lensBrand} onChange={(e) => setOptical((o) => ({ ...o, lensBrand: e.target.value }))}>
                    <option value="">无</option>
                    {brands.filter((b) => b.type === 'LENS').map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                  </Select>
                </Field>
                <Field label="镜片价格（元）" required>
                  <Input type="number" value={optical.lensPrice} onChange={(e) => setOptical((o) => ({ ...o, lensPrice: e.target.value }))} />
                </Field>
                <Field label="镜架品牌（可选）">
                  <Select value={optical.frameBrand} onChange={(e) => setOptical((o) => ({ ...o, frameBrand: e.target.value }))}>
                    <option value="">无</option>
                    {brands.filter((b) => b.type === 'FRAME').map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                  </Select>
                </Field>
                <Field label="镜架价格（元）" required>
                  <Input type="number" value={optical.framePrice} onChange={(e) => setOptical((o) => ({ ...o, framePrice: e.target.value }))} />
                </Field>
                <div className="col-span-2 text-right text-xs text-ink-500">
                  应付基础金额：{fmtCents(
                    (parseFloat(optical.lensPrice || '0') + parseFloat(optical.framePrice || '0')) * 100,
                  )} 元
                </div>
              </div>
            ) : (
              <div className="rounded-md bg-slate-50 p-3">
                <Field label="总金额（元）" required>
                  <Input type="number" value={eyeTotal} onChange={(e) => setEyeTotal(e.target.value)} />
                </Field>
              </div>
            )}

            {err && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>上一步</Button>
              <Button onClick={next2}>下一步：设置复查</Button>
            </div>
          </div>
        )}

        {/* Step 3: review + registrar + submit */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="多少天后复查" required hint="默认90天，可改">
                <Input type="number" value={reviewDays} onChange={(e) => setReviewDays(e.target.value)} />
              </Field>
              <Field label="复查日期（自动计算）">
                <Input value={computedReviewDate} readOnly />
              </Field>
              <Field label="登记人" required hint={`限${dept === 'OPTICAL' ? '配镜部' : '眼科部'}店员`}>
                <Select value={registeredById} onChange={(e) => setRegisteredById(e.target.value)}>
                  <option value="">请选择</option>
                  {registrarCandidates.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                </Select>
              </Field>
              <Field label="备注（可选）">
                <TextArea rows={1} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
              </Field>
            </div>
            {err && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>上一步</Button>
              <Button disabled={busy} onClick={submit}>{busy ? '提交中…' : '提交并去支付'}</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const labels = ['客户信息', '检查内容', '复查与提交'];
  return (
    <div className="flex items-center gap-2 text-xs">
      {labels.map((l, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${step >= i + 1 ? 'bg-brand-600 text-white' : 'bg-slate-200 text-ink-500'}`}>
            {i + 1}
          </span>
          <span className={step === i + 1 ? 'font-medium text-brand-700' : 'text-ink-500'}>{l}</span>
          {i < 2 && <span className="text-ink-300">→</span>}
        </div>
      ))}
    </div>
  );
}
