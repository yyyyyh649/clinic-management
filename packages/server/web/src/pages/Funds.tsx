// 资金池管理：现金池/储值池 每月新增/结余 + 每条新增明细
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Card, Input, Select, Button, fmtCents, fmtDateTime, EmptyState } from '../components/ui';

export default function Funds() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [storeId, setStoreId] = useState('');
  const [stores, setStores] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { api.listStores().then((s) => setStores(s || [])); }, []);
  async function load() {
    setData(null);
    const r = await api.funds(year, storeId || undefined);
    setData(r);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [year, storeId]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">资金池管理</h1>
        <p className="text-xs text-ink-500">现金池 = 充值收到的现金；储值池 = 充值增加的余额 + 手动调整增加的余额。结余 = 本月新增 - 本月消耗（消耗来自支付时的余额/豆抵扣）</p>
      </div>

      <Card title="筛选">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">年份</label>
            <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" />
          </div>
          <div>
            <label className="label">门店</label>
            <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="w-48">
              <option value="">全部门店</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <Button onClick={load}>查询</Button>
        </div>
      </Card>

      {!data ? <div className="text-sm text-ink-500">加载中…</div> : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Card title="本年现金池新增合计"><div className="text-2xl font-bold text-brand-700">{fmtCents(data.totalCash)} 元</div></Card>
            <Card title="本年储值池新增合计"><div className="text-2xl font-bold text-emerald-700">{fmtCents(data.totalStored)} 元</div></Card>
            <Card title="新增合计"><div className="text-2xl font-bold text-ink-900">{fmtCents(data.total)} 元</div></Card>
          </div>

          <Card title={`${year}年 各月资金池明细（点击展开查看每条新增记录）`}>
            <table className="tbl">
              <thead><tr><th>月份</th><th>现金池新增</th><th>储值池新增</th><th>新增合计</th><th>记录数</th><th></th></tr></thead>
              <tbody>
                {data.items.map((m: any) => (
                  <>
                    <tr key={m.month} className={m.details.length > 0 ? '' : 'text-ink-400'}>
                      <td>{m.month.split('-')[1]}月</td>
                      <td>{fmtCents(m.newCash)} 元</td>
                      <td>{fmtCents(m.newStored)} 元</td>
                      <td>{fmtCents(m.total)} 元</td>
                      <td>{m.details.length}</td>
                      <td>
                        {m.details.length > 0 && (
                          <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === m.month ? null : m.month)}>
                            {expanded === m.month ? '收起' : '展开明细'}
                          </Button>
                        )}
                      </td>
                    </tr>
                    {expanded === m.month && m.details.length > 0 && (
                      <tr key={m.month + '-detail'}>
                        <td colSpan={6} className="bg-slate-50 p-3">
                          <table className="tbl">
                            <thead><tr><th>时间</th><th>类型</th><th>卡号/会员</th><th>现金</th><th>储值</th><th>赠送豆</th><th>操作人</th><th>门店</th><th>备注</th></tr></thead>
                            <tbody>
                              {m.details.map((d: any) => (
                                <tr key={d.id}>
                                  <td>{fmtDateTime(d.createdAt)}</td>
                                  <td>{d.type === 'RECHARGE' ? <span className="text-brand-700">充值</span> : <span className="text-amber-700">手动调整</span>}</td>
                                  <td>{d.cardNo || d.memberId}</td>
                                  <td>{d.cashPaid != null ? fmtCents(d.cashPaid) : '—'}</td>
                                  <td>{d.balanceAdded != null ? fmtCents(d.balanceAdded) : (d.delta != null ? fmtCents(d.delta) : '—')}</td>
                                  <td>{d.beansGifted || '—'}</td>
                                  <td>{d.operatorName || '—'}</td>
                                  <td>{d.storeName || '—'}</td>
                                  <td>{d.note || d.reason || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
