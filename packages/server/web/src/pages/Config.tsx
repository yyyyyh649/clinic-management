// 后台配置管理：门店/设备/店员/档位/模板/品牌/设置 一站式 tab 管理.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Card, Button, Badge, Modal, Field, Input, Select, TextArea, EmptyState, fmtDateTime, fmtDate } from '../components/ui';

type Tab = 'stores' | 'devices' | 'staff' | 'tiers' | 'templates' | 'brands' | 'settings';

export default function Config() {
  const [tab, setTab] = useState<Tab>('stores');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">配置管理</h1>
        <p className="text-xs text-ink-500">所有配置项均可在界面增删改，无需重新部署代码</p>
      </div>
      <div className="flex gap-1 border-b border-slate-200">
        {([
          ['stores', '门店'], ['devices', '设备'], ['staff', '店员'], ['tiers', '档位'],
          ['templates', '检查模板'], ['brands', '品牌'], ['settings', '豆有效期'],
        ] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-brand-500 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-700'}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'stores' && <StoresTab />}
      {tab === 'devices' && <DevicesTab />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'tiers' && <TiersTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'brands' && <BrandsTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}

// ---------- Stores ----------
function StoresTab() {
  const [items, setItems] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ code: '', name: '' });
  async function load() { setItems(await api.listStores()); }
  useEffect(() => { load(); }, []);
  async function save() {
    if (!form.code || !form.name) return;
    if (editing) await api.updateStore(editing.id, form);
    else await api.createStore(form);
    setEditing(null); setForm({ code: '', name: '' }); await load();
  }
  return (
    <Card title="门店列表" extra={<Button onClick={() => { setEditing({}); setForm({ code: '', name: '' }); }}>+ 新增门店</Button>}>
      <table className="w-full text-sm">
        <thead className="text-xs text-ink-500"><tr className="border-b border-slate-200 text-left"><th className="py-2">编码</th><th>名称</th><th>创建时间</th><th></th></tr></thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className="border-b border-slate-100">
              <td className="py-2">{s.code}</td><td>{s.name}</td><td>{fmtDate(s.createdAt)}</td>
              <td><Button size="sm" variant="ghost" onClick={() => { setEditing(s); setForm({ code: s.code, name: s.name }); }}>编辑</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? '编辑门店' : '新增门店'}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>取消</Button><Button onClick={save}>保存</Button></>}>
        <div className="space-y-3">
          <Field label="门店编码" required><Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} disabled={!!editing?.id} /></Field>
          <Field label="门店名称" required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        </div>
      </Modal>
    </Card>
  );
}

// ---------- Devices ----------
function DevicesTab() {
  const [items, setItems] = useState<any[]>([]);
  async function load() { setItems(await api.listDevices()); }
  useEffect(() => { load(); }, []);
  return (
    <Card title="已绑定设备">
      {items.length === 0 ? <EmptyState text="暂无设备" /> :
        <table className="w-full text-sm">
          <thead className="text-xs text-ink-500"><tr className="border-b border-slate-200 text-left"><th className="py-2">设备编码</th><th>名称</th><th>所属门店</th><th>绑定时间</th><th>最后同步</th><th></th></tr></thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id} className="border-b border-slate-100">
                <td className="py-2">{d.deviceCode}</td><td>{d.displayName || '—'}</td><td>{d.store?.name}</td>
                <td>{fmtDateTime(d.boundAt)}</td><td>{fmtDateTime(d.lastSyncAt)}</td>
                <td><Button size="sm" variant="ghost" onClick={() => { if (confirm('确定删除此设备？')) api.deleteDevice(d.id).then(load); }}>删除</Button></td>
              </tr>
            ))}
          </tbody>
        </table>}
    </Card>
  );
}

// ---------- Staff ----------
function StaffTab() {
  const [items, setItems] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ name: '', code: '', depts: 'OPTICAL', isMember: false, memberId: '', phone: '', active: true });
  async function load() { setItems(await api.listStaff()); }
  useEffect(() => { load(); }, []);
  async function save() {
    if (!form.name || !form.code) return;
    if (editing?.id) await api.updateStaff(editing.id, form);
    else await api.createStaff(form);
    setEditing(null); await load();
  }
  return (
    <Card title={`店员列表（共 ${items.length} 人，在职 ${items.filter((s) => s.active).length}）`} extra={<Button onClick={() => { setEditing({}); setForm({ name: '', code: '', depts: 'OPTICAL', isMember: false, memberId: '', phone: '', active: true }); }}>+ 新增店员</Button>}>
      <table className="w-full text-sm">
        <thead className="text-xs text-ink-500"><tr className="border-b border-slate-200 text-left"><th className="py-2">姓名</th><th>工号</th><th>部门</th><th>是否会员</th><th>状态</th><th></th></tr></thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className="border-b border-slate-100">
              <td className="py-2">{s.name}</td><td>{s.code}</td>
              <td>{s.depts.split(',').map((d: string) => d === 'OPTICAL' ? '配镜部' : '眼科部').join('、')}</td>
              <td>{s.isMember ? <Badge tone="blue">会员</Badge> : '—'}</td>
              <td>{s.active ? <Badge tone="green">在职</Badge> : <Badge tone="slate">停用</Badge>}</td>
              <td><Button size="sm" variant="ghost" onClick={() => { setEditing(s); setForm({ name: s.name, code: s.code, depts: s.depts, isMember: s.isMember, memberId: s.memberId || '', phone: s.phone || '', active: s.active }); }}>编辑</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? '编辑店员' : '新增店员'}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>取消</Button><Button onClick={save}>保存</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="姓名" required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="工号" required><Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} disabled={!!editing?.id} /></Field>
          <Field label="部门（可多选，逗号分隔）">
            <Select value={form.depts} onChange={(e) => setForm((f) => ({ ...f, depts: e.target.value }))}>
              <option value="OPTICAL">配镜部</option>
              <option value="EYE">眼科部</option>
              <option value="OPTICAL,EYE">配镜部+眼科部</option>
            </Select>
          </Field>
          <Field label="手机号"><Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
          <Field label="是否也是会员"><Select value={form.isMember ? '1' : '0'} onChange={(e) => setForm((f) => ({ ...f, isMember: e.target.value === '1' }))}><option value="0">否</option><option value="1">是</option></Select></Field>
          {form.isMember && <Field label="关联会员ID"><Input value={form.memberId} onChange={(e) => setForm((f) => ({ ...f, memberId: e.target.value }))} /></Field>}
          <Field label="状态"><Select value={form.active ? '1' : '0'} onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === '1' }))}><option value="1">在职</option><option value="0">停用</option></Select></Field>
        </div>
      </Modal>
    </Card>
  );
}

// ---------- Tiers ----------
function TiersTab() {
  const [items, setItems] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const blank = { name: '', minPoints: 0, clearEnabled: false, clearPeriod: '', clearMonth: '', clearDay: '' };
  const [form, setForm] = useState<any>(blank);
  async function load() { setItems(await api.listTiers()); }
  useEffect(() => { load(); }, []);
  async function save() {
    const payload = { ...form, minPoints: Number(form.minPoints) || 0, clearMonth: form.clearMonth ? Number(form.clearMonth) : null, clearDay: form.clearDay ? Number(form.clearDay) : null };
    if (editing?.id) await api.updateTier(editing.id, payload);
    else await api.createTier(payload);
    setEditing(null); setForm(blank); await load();
  }
  return (
    <Card title="会员档位（最多20档，累计积分清零只影响档位判定，不影响豆）" extra={<Button onClick={() => { setEditing({}); setForm(blank); }}>+ 新增档位</Button>}>
      <table className="w-full text-sm">
        <thead className="text-xs text-ink-500"><tr className="border-b border-slate-200 text-left"><th className="py-2">档位</th><th>所需累计积分</th><th>清零周期</th><th></th></tr></thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className="border-b border-slate-100">
              <td className="py-2">{t.name} (Lv.{t.level})</td><td>{t.minPoints}</td>
              <td>{t.clearEnabled ? `${t.clearPeriod === 'YEAR' ? '每年' : '每月'}${t.clearPeriod === 'YEAR' ? `${t.clearMonth}月` : ''}${t.clearDay}日` : '不清零'}</td>
              <td>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(t); setForm({ ...blank, ...t, clearMonth: t.clearMonth || '', clearDay: t.clearDay || '' }); }}>编辑</Button>
                <Button size="sm" variant="ghost" onClick={() => { if (confirm('确定删除此档位？')) api.deleteTier(t.id).then(load); }}>删除</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? '编辑档位' : '新增档位'}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>取消</Button><Button onClick={save}>保存</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="档位名" required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="所需累计积分门槛" required><Input type="number" value={form.minPoints} onChange={(e) => setForm((f) => ({ ...f, minPoints: e.target.value }))} /></Field>
          <Field label="启用清零周期"><Select value={form.clearEnabled ? '1' : '0'} onChange={(e) => setForm((f) => ({ ...f, clearEnabled: e.target.value === '1' }))}><option value="0">否（永不清零）</option><option value="1">是</option></Select></Field>
          {form.clearEnabled && <>
            <Field label="周期"><Select value={form.clearPeriod} onChange={(e) => setForm((f) => ({ ...f, clearPeriod: e.target.value }))}><option value="">请选择</option><option value="YEAR">每年</option><option value="MONTH">每月</option></Select></Field>
            {form.clearPeriod === 'YEAR' && <Field label="月份（1-12）"><Input type="number" value={form.clearMonth} onChange={(e) => setForm((f) => ({ ...f, clearMonth: e.target.value }))} /></Field>}
            <Field label="日期（1-31）"><Input type="number" value={form.clearDay} onChange={(e) => setForm((f) => ({ ...f, clearDay: e.target.value }))} /></Field>
          </>}
        </div>
      </Modal>
    </Card>
  );
}

// ---------- Templates ----------
function TemplatesTab() {
  const [items, setItems] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const blank = { name: '', dept: 'OPTICAL', pages: [{ title: '第1页', questions: [{ id: 'q1', type: 'FILL', title: '问题1', required: false }] }] };
  const [form, setForm] = useState<any>(blank);
  async function load() { setItems(await api.listTemplates()); }
  useEffect(() => { load(); }, []);
  async function save() {
    if (editing?.id) await api.updateTemplate(editing.id, { name: form.name, pages: form.pages });
    else await api.createTemplate({ name: form.name, dept: form.dept, pages: form.pages });
    setEditing(null); setForm(blank); await load();
  }
  function addPage() { setForm((f) => ({ ...f, pages: [...f.pages, { title: `第${f.pages.length + 1}页`, questions: [] }] })); }
  function addQuestion(pi: number) {
    setForm((f) => {
      const pages = [...f.pages];
      pages[pi] = { ...pages[pi], questions: [...pages[pi].questions, { id: `q${Date.now()}`, type: 'FILL', title: '新问题', required: false }] };
      return { ...f, pages };
    });
  }
  return (
    <Card title="检查模板编辑（病历/验光单各最多10个，支持多页+选择题/填空题，选择题最后一项默认是其他）" extra={<Button onClick={() => { setEditing({}); setForm(blank); }}>+ 新增模板</Button>}>
      <table className="w-full text-sm">
        <thead className="text-xs text-ink-500"><tr className="border-b border-slate-200 text-left"><th className="py-2">名称</th><th>部门</th><th>页数</th><th>状态</th><th></th></tr></thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className="border-b border-slate-100">
              <td className="py-2">{t.name}</td><td>{t.dept === 'OPTICAL' ? '配镜部' : '眼科部'}</td>
              <td>{t.pages?.length || 0}</td><td>{t.isActive ? <Badge tone="green">启用</Badge> : <Badge tone="slate">停用</Badge>}</td>
              <td>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(t); setForm({ name: t.name, dept: t.dept, pages: t.pages || [] }); }}>编辑</Button>
                <Button size="sm" variant="ghost" onClick={() => { if (confirm('确定删除？')) api.deleteTemplate(t.id).then(load); }}>删除</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? '编辑模板' : '新增模板'} wide
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>取消</Button><Button onClick={save}>保存</Button></>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="模板名" required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="部门" required><Select value={form.dept} onChange={(e) => setForm((f) => ({ ...f, dept: e.target.value }))} disabled={!!editing?.id}><option value="OPTICAL">配镜部</option><option value="EYE">眼科部</option></Select></Field>
          </div>
          {form.pages.map((p: any, pi: number) => (
            <div key={pi} className="rounded-md border border-slate-200 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Input value={p.title} onChange={(e) => { const pages = [...form.pages]; pages[pi] = { ...p, title: e.target.value }; setForm((f) => ({ ...f, pages })); }} className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => setForm((f) => ({ ...f, pages: f.pages.filter((_: any, i: number) => i !== pi) }))}>删页</Button>
              </div>
              <div className="space-y-2">
                {p.questions.map((q: any, qi: number) => (
                  <div key={qi} className="grid grid-cols-12 gap-2">
                    <Input value={q.title} onChange={(e) => { const pages = [...form.pages]; pages[pi].questions[qi] = { ...q, title: e.target.value }; setForm((f) => ({ ...f, pages })); }} className="col-span-5" placeholder="问题标题" />
                    <Select value={q.type} onChange={(e) => { const pages = [...form.pages]; pages[pi].questions[qi] = { ...q, type: e.target.value }; setForm((f) => ({ ...f, pages })); }} className="col-span-3">
                      <option value="FILL">填空</option>
                      <option value="CHOICE">选择</option>
                    </Select>
                    <Select value={q.required ? '1' : '0'} onChange={(e) => { const pages = [...form.pages]; pages[pi].questions[qi] = { ...q, required: e.target.value === '1' }; setForm((f) => ({ ...f, pages })); }} className="col-span-2">
                      <option value="0">选填</option>
                      <option value="1">必填</option>
                    </Select>
                    <Button size="sm" variant="ghost" className="col-span-2" onClick={() => { const pages = [...form.pages]; pages[pi].questions = pages[pi].questions.filter((_: any, i: number) => i !== qi); setForm((f) => ({ ...f, pages })); }}>删</Button>
                    {q.type === 'CHOICE' && (
                      <div className="col-span-12">
                        <Input value={(q.options || []).join(',')} onChange={(e) => { const pages = [...form.pages]; pages[pi].questions[qi] = { ...q, options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }; setForm((f) => ({ ...f, pages })); }} placeholder="选项，逗号分隔（最后一项默认是其他）" />
                      </div>
                    )}
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => addQuestion(pi)}>+ 加问题</Button>
              </div>
            </div>
          ))}
          <Button variant="ghost" onClick={addPage}>+ 加页</Button>
        </div>
      </Modal>
    </Card>
  );
}

// ---------- Brands ----------
function BrandsTab() {
  const [items, setItems] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const blank = { name: '', type: 'LENS', sortIndex: 0, active: true };
  const [form, setForm] = useState<any>(blank);
  async function load() { setItems(await api.listBrands()); }
  useEffect(() => { load(); }, []);
  async function save() {
    if (editing?.id) await api.updateBrand(editing.id, form);
    else await api.createBrand(form);
    setEditing(null); setForm(blank); await load();
  }
  return (
    <Card title={`品牌管理（全连锁共用一套，共 ${items.length} 个，无数量限制）`} extra={<Button onClick={() => { setEditing({}); setForm(blank); }}>+ 新增品牌</Button>}>
      <div className="grid grid-cols-2 gap-4">
        {['LENS', 'FRAME'].map((type) => (
          <div key={type}>
            <div className="mb-2 text-xs font-semibold text-ink-700">{type === 'LENS' ? `镜片品牌（${items.filter((b) => b.type === type).length}）` : `镜架品牌（${items.filter((b) => b.type === type).length}）`}</div>
            <table className="w-full text-sm">
              <tbody>
                {items.filter((b) => b.type === type).map((b) => (
                  <tr key={b.id} className="border-b border-slate-100">
                    <td className="py-2">{b.name}</td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(b); setForm({ name: b.name, type: b.type, sortIndex: b.sortIndex, active: b.active }); }}>编辑</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? '编辑品牌' : '新增品牌'}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>取消</Button><Button onClick={save}>保存</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="品牌名" required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="类型" required><Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} disabled={!!editing?.id}><option value="LENS">镜片</option><option value="FRAME">镜架</option></Select></Field>
          <Field label="排序"><Input type="number" value={form.sortIndex} onChange={(e) => setForm((f) => ({ ...f, sortIndex: Number(e.target.value) }))} /></Field>
          <Field label="启用"><Select value={form.active ? '1' : '0'} onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === '1' }))}><option value="1">启用</option><option value="0">停用</option></Select></Field>
        </div>
      </Modal>
    </Card>
  );
}

// ---------- Settings (bean expiry) ----------
function SettingsTab() {
  const [s, setS] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => { api.getSettings().then(setS); }, []);
  async function save() {
    await api.updateSettings(s);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }
  return (
    <Card title="豆的有效期设置（不设置 = 永久有效；规则改动不追溯已产生的豆）"
      extra={<Button onClick={save}>{saved ? '已保存' : '保存'}</Button>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="启用豆有效期" hint="启用后每笔新豆按获得时间+有效期算到期日，到期自动核销，按 FIFO 扣减">
          <Select value={s['beanExpiry.enabled'] || 'false'} onChange={(e) => setS((p) => ({ ...p, 'beanExpiry.enabled': e.target.value }))}>
            <option value="false">不启用（永久有效）</option>
            <option value="true">启用</option>
          </Select>
        </Field>
        {s['beanExpiry.enabled'] === 'true' && (
          <Field label="有效月数"><Input type="number" value={s['beanExpiry.months'] || '12'} onChange={(e) => setS((p) => ({ ...p, 'beanExpiry.months': e.target.value }))} /></Field>
        )}
      </div>
    </Card>
  );
}
