// 检查详情 (§5.2): full info + customer_id history (会员可跳会员详情) + 复查状态操作.
// B.7: payment (if any) is shown in full — discount, balance/beans deduct, cash, edit reason,
//      awarded beans/points, operator & store. Unpaid exams get a 作废本单 + 继续支付 button (B.6).
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Card, Button, Badge, Select, EmptyState, fmtDate, fmtDateTime, fmtCents } from '../components/ui';

export default function ExamDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<any>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [status, setStatus] = useState('PENDING');
  const [reviewerId, setReviewerId] = useState('');
  const [note, setNote] = useState('');
  const [voiding, setVoiding] = useState(false);

  async function load() {
    if (!id) return;
    const r = await api.getExam(id);
    setData(r);
    setStatus(r.exam?.reviewStatus || 'PENDING');
    setReviewerId(r.exam?.reviewerId || '');
    setNote(r.exam?.reviewNote || '');
  }
  useEffect(() => { load(); api.getStaff().then((s: any) => setStaff(s || [])); /* eslint-disable-next-line */ }, [id]);

  async function saveReview() {
    if (!id) return;
    const rev = staff.find((s) => s.id === reviewerId);
    await api.updateReview(id, { reviewStatus: status, reviewerId, reviewerName: rev?.name || '', reviewNote: note });
    await load();
  }

  async function voidDraft() {
    if (!id) return;
    if (!confirm('确认作废这条未支付的草稿？作废后不会出现在任何统计和列表里（不可恢复）。')) return;
    setVoiding(true);
    try {
      await api.voidExam(id);
      nav('/exam');
    } catch (e: any) {
      alert(e.message || '作废失败');
    } finally {
      setVoiding(false);
    }
  }

  if (!data) return <div className="text-sm text-ink-500">加载中…</div>;
  const { exam, customer, history } = data;
  const reviewerCandidates = staff.filter((s) => s.depts?.split(',').includes(exam.dept));
  const pay = exam.payment;

  return (
    <div className="space-y-4">
      <Card title={`检查详情 · ${exam.dept === 'OPTICAL' ? '配镜部' : '眼科部'}`} extra={<Button variant="ghost" onClick={() => nav('/exam')}>返回列表</Button>}>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5 text-sm">
            <Row label="姓名" value={customer?.name} />
            <Row label="手机号" value={customer?.phone} />
            <Row label="年龄" value={data.age != null ? `${data.age}岁` : '—'} />
            <Row label="住址" value={customer?.address || '—'} />
            {customer?.isMember && <Row label="会员" value={<Button size="sm" variant="ghost" onClick={() => nav(`/member/${customer.memberId}`)}>查看会员详情 →</Button>} />}
          </div>
          <div className="space-y-1.5 text-sm">
            {exam.dept === 'OPTICAL' ? (
              <>
                <Row label="镜片" value={`${exam.lensBrand || '—'} · ${fmtCents(exam.lensPrice)}元`} />
                <Row label="镜架" value={`${exam.frameBrand || '—'} · ${fmtCents(exam.framePrice)}元`} />
                <Row label="应付基础" value={<span className="font-semibold">{fmtCents(exam.baseAmount)} 元</span>} />
              </>
            ) : (
              <Row label="总金额" value={<span className="font-semibold">{fmtCents(exam.totalAmount)} 元</span>} />
            )}
          </div>
          <div className="space-y-1.5 text-sm">
            <Row label="登记时间" value={fmtDateTime(exam.registeredAt)} />
            <Row label="登记人" value={exam.registeredByName} />
            <Row label="登记门店" value={exam.registeredStoreName} />
            <Row label="复查日期" value={fmtDate(exam.reviewDate)} />
            <Row label="状态" value={<Badge tone={exam.reviewStatus === 'REVIEWED' ? 'green' : exam.reviewStatus === 'PENDING' ? 'amber' : 'slate'}>{statusLabel(exam.reviewStatus)}</Badge>} />
            <Row label="支付" value={pay ? <Badge tone="green">已支付</Badge> : <Badge tone="slate">未支付</Badge>} />
          </div>
        </div>
      </Card>

      {/* B.7: full payment breakdown (only when paid) */}
      {pay && (
        <Card title="支付明细" extra={<Badge tone="green">已支付</Badge>}>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5 text-sm">
              <Row label="应付基础" value={`${fmtCents(pay.baseAmount)} 元`} />
              <Row label="折扣类型" value={pay.discountType === 'PERCENT' ? `折扣 ${pay.discountValue}%` : pay.discountType === 'MINUS' ? `立减 ${fmtCents(pay.discountValue)} 元` : '无'} />
              <Row label="折后应付" value={<span className="font-semibold">{fmtCents(pay.afterDiscount)} 元</span>} />
            </div>
            <div className="space-y-1.5 text-sm">
              <Row label="余额抵扣" value={`${fmtCents(pay.balanceDeduct)} 元`} />
              <Row label="豆抵扣" value={`${pay.beansDeduct} 豆（折 ${fmtCents(pay.beansDeductAmount)} 元）`} />
              <Row label="实付现金" value={<span className="font-semibold">{fmtCents(pay.cashPaid)} 元</span>} />
              {pay.cashPaidEdited && <Row label="手动修改" value={<Badge tone="amber">是 · {pay.editReason || '无备注'}</Badge>} />}
            </div>
            <div className="space-y-1.5 text-sm">
              <Row label="获得豆" value={`${pay.beansAwarded} 豆`} />
              <Row label="累计积分" value={`${pay.pointsAwarded} 分`} />
              {pay.payForMemberId && <Row label="代付会员" value={`${pay.payForMemberName || '—'} · ${pay.payForMemberCardNo || ''}`} />}
              {pay.awardMemberId && <Row label="豆/积分归属" value={pay.awardMemberName || '—'} />}
              <Row label="操作人" value={pay.operatorName || exam.registeredByName || '—'} />
              <Row label="支付门店" value={pay.storeName || exam.registeredStoreName || '—'} />
              <Row label="支付时间" value={fmtDateTime(pay.createdAt)} />
            </div>
          </div>
        </Card>
      )}

      {/* B.6: unpaid draft — offer to continue payment or void it */}
      {!pay && (
        <Card title="未支付草稿" extra={<Badge tone="slate">未支付</Badge>}>
          <p className="mb-3 text-sm text-ink-500">这单检查尚未完成支付。可继续支付，或作废本单（作废后不会出现在任何统计和列表里，等同未发生过）。</p>
          <div className="flex gap-2">
            <Button onClick={() => nav(`/payment/${exam.id}`)}>继续支付</Button>
            <Button variant="danger" disabled={voiding} onClick={voidDraft}>{voiding ? '作废中…' : '作废本单'}</Button>
          </div>
        </Card>
      )}

      {/* Template content rendering */}
      {exam.content?.template && (
        <Card title={`模板内容：${exam.templateName || ''}`}>
          <div className="space-y-3">
            {exam.content.template.map((p: any, pi: number) => (
              <div key={pi} className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 text-xs font-semibold text-ink-700">{pi + 1}. {p.title}</div>
                <div className="grid grid-cols-2 gap-2">
                  {p.questions.map((q: any) => {
                    let val = exam.content.answers?.[q.id] || '';
                    if (val === '__other') val = `其他：${exam.content.answers?.[`${q.id}__text`] || ''}`;
                    return <Row key={q.id} label={q.title} value={val || '—'} />;
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 复查状态操作 */}
      <Card title="复查状态管理">
        <div className="grid grid-cols-3 gap-3">
          <Field label="状态">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="PENDING">待复查（留顶部）</option>
              <option value="CONTACTED">已联系（留顶部）</option>
              <option value="CONTACTED_NO_SHOW">已联系不到店（移底部，不删记录）</option>
              <option value="REVIEWED">已复查</option>
            </Select>
          </Field>
          <Field label="复查记录人">
            <Select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
              <option value="">请选择</option>
              {reviewerCandidates.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="备注">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={saveReview}>保存复查</Button></div>
      </Card>

      <Card title="该客户历史检查记录（关联 customer_id，跨门店）">
        {history?.length === 0 ? <EmptyState text="暂无历史记录" /> :
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-500">
              <tr className="border-b border-slate-200 text-left">
                <th className="py-2">时间</th><th>部门</th><th>金额</th><th>复查</th><th>登记门店</th><th></th>
              </tr>
            </thead>
            <tbody>
              {history.map((e: any) => (
                <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => nav(`/exam/${e.id}`)}>
                  <td className="py-2">{fmtDateTime(e.registeredAt)}</td>
                  <td>{e.dept === 'OPTICAL' ? '配镜部' : '眼科部'}</td>
                  <td>{fmtCents(e.baseAmount)}</td>
                  <td>{fmtDate(e.reviewDate)}</td>
                  <td>{e.registeredStoreName}</td>
                  <td className="text-brand-600">查看 →</td>
                </tr>
              ))}
            </tbody>
          </table>}
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}
function Row({ label, value }: { label: string; value: any }) {
  return <div className="flex items-center justify-between"><span className="text-ink-500">{label}</span><span className="font-medium text-ink-900">{value ?? '—'}</span></div>;
}
function statusLabel(s: string) {
  return { PENDING: '待复查', CONTACTED: '已联系', CONTACTED_NO_SHOW: '已联系不到店', REVIEWED: '已复查' }[s] || s;
}
