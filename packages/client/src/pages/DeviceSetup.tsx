// First-run device setup: bind this front-desk device to a store via backend password.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { notifyDeviceChanged } from '../hooks/useApp';
import { Button, Card, Field, Input, Select } from '../components/ui';

export default function DeviceSetup() {
  const [stores, setStores] = useState<any[]>([]);
  const [password, setPassword] = useState('safe@safe');
  const [storeCode, setStoreCode] = useState('');
  const [deviceCode, setDeviceCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getStores().then((s: any) => setStores(s || [])).catch(() => setStores([]));
    // Pre-fill device code with a random suffix for convenience.
    setDeviceCode(`D${Math.floor(Math.random() * 9000 + 1000)}`);
  }, []);

  async function submit() {
    setErr(''); setBusy(true);
    try {
      if (!storeCode || !deviceCode) throw new Error('请选择门店并填写设备编码');
      const identity = await api.registerDevice({ password, storeCode, deviceCode, displayName });
      notifyDeviceChanged(identity);
      // Trigger an immediate sync to pull full chain cache.
      await api.syncNow().catch(() => {});
    } catch (e: any) {
      setErr(e.message || '注册失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md" title="前台设备首次绑定">
        <p className="mb-4 text-sm text-ink-500">
          请填写后台密码和门店信息完成设备绑定。绑定后该设备产生的所有记录将自动带上此门店标签。
        </p>
        <div className="space-y-3">
          <Field label="后台密码" required hint="部署设备时由后台密码控制，默认 safe@safe">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="门店" required>
            <Select value={storeCode} onChange={(e) => setStoreCode(e.target.value)}>
              <option value="">请选择门店</option>
              {stores.map((s) => (
                <option key={s.id} value={s.code}>{s.name} ({s.code})</option>
              ))}
            </Select>
          </Field>
          <Field label="设备编码" required hint="本设备唯一编码，绑定后不可改">
            <Input value={deviceCode} onChange={(e) => setDeviceCode(e.target.value)} />
          </Field>
          <Field label="设备名称（可选）">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="如：1号前台" />
          </Field>
          {err && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
          <Button className="w-full" disabled={busy} onClick={submit}>
            {busy ? '绑定中…' : '绑定设备'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
