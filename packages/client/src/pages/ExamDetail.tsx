// 检查详情 (§5.2): full info + customer_id history (会员可跳会员详情) + 复查状态操作.
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

  if (!data) return <div className="text-sm text-ink-500">加载中…</div>;
  const { exam, customer, history } = data;
  const reviewerCandidates = staff.filter((s) => s.depts?.split(',').includes(exam.dept));

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
            <Row label="支付" value={exam.payment ? <Badge tone="green">已支付</Badge> : <Badge tone="slate">未支付</Badge>} />
          </div>
        </div>
      </Card>

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
