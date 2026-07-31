import { useEffect, useState } from 'react';
import { api } from '../api';
import { Card, Select, Button } from '../components/ui';

export default function ExportPage() {
  const [stores, setStores] = useState<any[]>([]);
  const [storeId, setStoreId] = useState('');
  const [type, setType] = useState<'members' | 'exams' | 'payments' | 'recharges'>('members');

  useEffect(() => { api.listStores().then((s) => setStores(s || [])); }, []);

  function url() {
    return api.exportUrl(type, storeId || undefined);
  }

  const descriptions: Record<typeof type, string> = {
    members: '会员全量数据（卡号、姓名、手机号、生日、档位、累计积分、豆、余额、登记人、登记门店、登记时间）',
    exams: '检查记录全量数据（部门、客户、品牌、价格、复查日期、状态、登记人、登记门店）',
    payments: '支付记录全量数据（应付、折后、抵扣、实付、获得豆/积分、代付会员、操作人、门店）',
    recharges: '充值记录全量数据（卡号、现金、储值增加、赠送豆/积分、操作人、门店）',
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">数据导出</h1>
        <p className="text-xs text-ink-500">导出当前全部记录，支持 Excel 格式（CSV），支持按门店筛选</p>
      </div>
      <Card title="导出选项">
        <div className="grid grid-cols-3 gap-3">
          <Select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="members">会员</option>
            <option value="exams">检查记录</option>
            <option value="payments">支付记录</option>
            <option value="recharges">充值记录</option>
          </Select>
          <Select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">全部门店</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <a href={url()} download>
            <Button className="w-full">下载 CSV</Button>
          </a>
        </div>
        <p className="mt-3 text-xs text-ink-500">当前选择：{descriptions[type]}</p>
      </Card>
    </div>
  );
}
