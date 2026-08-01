// 检查登记 (§3.2): customer info → dept template → content → review → 跳支付.
// C.1: phone uses PhoneInput (realtime validation).
// C.2: birthday defaults to today.
// C.5: 复查记录人 removed — only 登记人 remains.
// C.6: review is "days from registration" input, auto-computes the review date.
// B.9: 登记人 dropdown limited to staff in the selected dept.
//
// 编辑模式 (route /exam/:id/edit): 预填全部检查单字段，全字段可改（含登记时间、复查日期、
// 模板内容、品牌价格、登记人），提交走 updateExam 而非 createExam，提交后回详情页（不跳支付）。
// 客户信息（姓名/手机号）为只读展示——那属于客户实体，改手机号需走会员详情的敏感修改流程。
import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api';
import { Button, Card, Field, Input, Select, TextArea, fmtCents, parseYuanToCents } from '../components/ui';
import { PhoneInput, isPhoneValid } from '../components/PhoneInput';
// DEFAULT_REVIEW_DAYS = 90 (defined inline to avoid importing @clinic/shared,
// whose barrel re-exports the Prisma client — pulling Prisma into the renderer
// bundle breaks the browser environment with "process is not defined").
const DEFAULT_REVIEW_DAYS = 90;
const todayStr = () => new Date().toISOString().slice(0, 10);
// datetime-local 输入需要本地时间格式（不含时区后缀）。
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const toLocalInput = (d: Date | string) => {
  const date = new Date(d);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const addDaysFromStr = (from: string, days: number) => {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

interface Page {
  title: string;
  questions: { id: string; type: 'FILL' | 'CHOICE'; title: string; required?: boolean; options?: string[]; other?: boolean }[];
}

export default function ExamRegister() {
  const params = useParams();
  const editId = params.id as string | undefined; // 存在 => 编辑模式
  const nav = useNavigate();
  const loc = useLocation();
  // §password-flow: the CHANGE password verified in ExamDetail is carried here
  // via router state and submitted with the write (server re-verifies inline).
  const editPwd = (loc.state as any)?.changePassword as string | undefined;
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
  // C.6: review is "N days from registration" (default 90), the date is computed & shown read-only.
  const [reviewDays, setReviewDays] = useState<string>(String(DEFAULT_REVIEW_DAYS));
  const [reviewNote, setReviewNote] = useState('');
  const [registeredById, setRegisteredById] = useState('');
  // 登记时间可自定义（默认当前时间）；编辑模式下预填原值，允许补录/修正历史登记时间。
  const [registeredAt, setRegisteredAt] = useState<string>(nowLocal());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dedupMsg, setDedupMsg] = useState('');
  const [loaded, setLoaded] = useState(!editId); // 编辑模式需先加载完才渲染表单
  // 编辑模式：exam.content 里存的 template 结构（模板可能已被删除/更新，用它回填答案渲染）。
  const [examTplPages, setExamTplPages] = useState<Page[]>([]);

  useEffect(() => {
    api.getStaff().then((s: any) => setStaff(s || []));
    api.getBrands().then((b: any) => setBrands(b || []));
  }, []);

  // 编辑模式：加载已有检查单并预填全部字段。
  useEffect(() => {
    if (!editId) return;
    api.getExam(editId).then((r: any) => {
      const e = r.exam;
      setForm({
        name: r.customer?.name || '', phone: r.customer?.phone || '',
        birthday: r.customer?.birthday ? new Date(r.customer.birthday).toISOString().slice(0, 10) : todayStr(),
        address: r.customer?.address || '', customerId: r.customer?.id || '', existingMember: r.customer,
      });
      setDept(e.dept);
      setTemplateId(e.templateId || '');
      // content 存了 template + answers，预填 answers + 用存的 template 结构渲染
      if (e.content?.answers) setAnswers(e.content.answers);
      if (e.content?.template) setExamTplPages(e.content.template);
      setOptical({
        lensBrand: e.lensBrand || '', lensPrice: e.lensPrice != null ? String(e.lensPrice / 100) : '',
        frameBrand: e.frameBrand || '', framePrice: e.framePrice != null ? String(e.framePrice / 100) : '',
      });
      setEyeTotal(e.totalAmount != null ? String(e.totalAmount / 100) : '');
      setReviewNote(e.reviewNote || '');
      setRegisteredById(e.registeredBy);
      setRegisteredAt(toLocalInput(e.registeredAt));
      // 复查天数 = (reviewDate - registeredAt) 的天数
      const diffDays = Math.round((new Date(e.reviewDate).getTime() - new Date(e.registeredAt).getTime()) / 86400000);
      setReviewDays(String(diffDays || DEFAULT_REVIEW_DAYS));
      setLoaded(true);
    }).catch(() => { setErr('加载检查单失败'); setLoaded(true); });
  }, [editId]);

  // Templates filtered by dept. C.5/B.9: 登记人 also limited to current dept.
  useEffect(() => {
    api.getTemplates(dept).then((t: any) => { setTemplates(t || []); /* 保留已选 templateId 若仍在列表中 */ });
    setRegisteredById((cur) => {
      const stillValid = staff.some((s) => s.id === cur && s.depts?.split(',').map((d: string) => d.trim()).includes(dept));
      return stillValid ? cur : '';
    });
  }, [dept, staff]);
  const registrarCandidates = useMemo(
    () => staff.filter((s) => (s.depts || '').split(',').map((d: string) => d.trim()).includes(dept)),
    [staff, dept],
  );

  const tpl = templates.find((t) => t.id === templateId);
  // 模板仍存在用最新结构；模板已删除则回退到 exam 里存的 template 结构渲染已填答案。
  const tplPages: Page[] = tpl?.pages || examTplPages;

  // 复查日期 = 登记时间 + N 天（登记时间改了会联动重算）。
  const reviewDaysNum = parseInt(reviewDays, 10);
  const computedReviewDate = Number.isNaN(reviewDaysNum) ? '' : addDaysFromStr(registeredAt, reviewDaysNum);

  async function checkPhone(phone: string) {
    if (editId) return; // 编辑模式不查重
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
    if (editId) { setErr(''); setStep(2); return; } // 编辑模式跳过客户校验
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
    if (editId && !editPwd) { setErr('缺少修改密码，请返回详情页重新通过密码验证'); return; }
    setErr(''); setBusy(true);
    try {
      const reg = staff.find((s) => s.id === registeredById);
      const payload = {
        dept,
        templateId: templateId || undefined,
        templateName: tpl?.name,
        content: tplPages.length ? { template: tplPages, answers } : undefined,
        lensBrand: dept === 'OPTICAL' ? optical.lensBrand || undefined : undefined,
        lensPrice: dept === 'OPTICAL' ? parseYuanToCents(optical.lensPrice || '0') : undefined,
        frameBrand: dept === 'OPTICAL' ? optical.frameBrand || undefined : undefined,
        framePrice: dept === 'OPTICAL' ? parseYuanToCents(optical.framePrice || '0') : undefined,
        totalAmount: dept === 'EYE' ? parseYuanToCents(eyeTotal) : undefined,
        reviewDate: computedReviewDate,
        reviewNote: reviewNote || undefined,
        registeredById, registeredByName: reg?.name || '',
        registeredAt,
        // §password-flow: password travels with the write (server re-verifies).
        changePassword: editId ? editPwd : undefined,
      };
      if (editId) {
        // §2.2 versioning: updateExam returns the NEW revision record (new id),
        // not the old one. Navigate to the new record so the user sees the fresh version.
        const created = await api.updateExam(editId, payload);
        nav(`/exam/${created.id}`);
      } else {
        const exam = await api.createExam({
          ...payload,
          customerId: form.customerId || undefined,
          name: form.name, phone: form.phone, address: form.address || undefined,
          birthday: form.birthday || undefined,
        });
        nav(`/payment/${exam.id}`);
      }
    } catch (e: any) {
      setErr(e.message || '提交失败');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <div className="text-sm text-ink-500">加载中…</div>;

  return (
    <div className="mx-auto max-w-4xl">
      <Card title={editId ? '修改检查单' : '检查登记'} extra={<><Stepper step={step} />{editId && <Button size="sm" variant="ghost" onClick={() => nav(`/exam/${editId}`)}>取消</Button>}</>}>
        {/* Step 1: customer info (编辑模式只读展示) */}
        {step === 1 && (
          <div className="space-y-4">
            {editId ? (
              <div className="grid grid-cols-2 gap-4">
                <Field label="姓名"><Input value={form.name} readOnly className="bg-slate-50" /></Field>
                <Field label="手机号"><Input value={form.phone} readOnly className="bg-slate-50" /></Field>
                <Field label="生日"><Input value={form.birthday} readOnly className="bg-slate-50" /></Field>
                <Field label="住址"><Input value={form.address} readOnly className="bg-slate-50" /></Field>
                <div className="col-span-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  客户信息为只读。如需修改姓名/手机号，请到会员详情页走敏感信息修改流程。
                </div>
              </div>
            ) : (
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
                <Field label="生日（可选）" hint="用于自动计算年龄，不能选今天及以后">
                  <Input type="date" max={todayStr()} value={form.birthday} onChange={(e) => setForm((f) => ({ ...f, birthday: e.target.value }))} />
                </Field>
                <Field label="住址（可选）">
                  <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                </Field>
              </div>
            )}
            {dedupMsg && <div className="rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-700">{dedupMsg}</div>}
            {form.existingMember?.isMember && (
              <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                <span>该客户已是会员。</span>
                <Button size="sm" variant="ghost" onClick={() => nav(`/member/${form.existingMember.memberId}`)}>查看会员详情</Button>
              </div>
            )}
            {form.existingMember && !form.existingMember.isMember && !editId && (
              <div className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <span>该客户尚未办理会员。</span>
                <Button size="sm" variant="ghost" onClick={() => nav('/member/register')}>去办会员</Button>
              </div>
            )}
            {err && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
            <div className="flex justify-end">
              <Button onClick={next1}>{editId ? '下一步：修改检查内容' : '下一步：选模板'}</Button>
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
                    parseYuanToCents(optical.lensPrice || '0') + parseYuanToCents(optical.framePrice || '0'),
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

        {/* Step 3: review + registrar + registeredAt + submit */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="多少天后复查" required hint="相对登记时间计算，默认90天，可改">
                <Input type="number" value={reviewDays} onChange={(e) => setReviewDays(e.target.value)} />
              </Field>
              <Field label="复查日期（自动计算）">
                <Input value={computedReviewDate} readOnly />
              </Field>
              <Field label="登记时间" required hint="默认当前时间，可改以补录历史登记">
                <Input type="datetime-local" value={registeredAt} onChange={(e) => setRegisteredAt(e.target.value)} />
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
              <Button disabled={busy} onClick={submit}>{busy ? '提交中…' : editId ? '保存修改' : '提交并去支付'}</Button>
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
