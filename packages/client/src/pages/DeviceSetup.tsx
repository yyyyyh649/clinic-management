// First-run device setup: configure cloud server URL, then bind this front-desk device to a store.
import { useEffect, useState } from 'react';
import { api, isElectron } from '../api';
import { notifyDeviceChanged } from '../hooks/useApp';
import { Button, Card, Field, Input, Select } from '../components/ui';

export default function DeviceSetup() {
  // Step 1: server URL
  const [serverUrl, setServerUrl] = useState('');
  const [serverTested, setServerTested] = useState(false);
  const [pingBusy, setPingBusy] = useState(false);
  const [pingMsg, setPingMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Step 2: device bind
  const [stores, setStores] = useState<any[]>([]);
  const [password, setPassword] = useState('safe@safe');
  const [storeCode, setStoreCode] = useState('');
  const [deviceCode, setDeviceCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Load saved server URL (Electron persists it to userData/server.json).
    if (isElectron) {
      api.getServerUrl().then((u: string) => setServerUrl(u || ''));
    }
    setDeviceCode(`D${Math.floor(Math.random() * 9000 + 1000)}`);
  }, []);

  async function testServer() {
    setPingBusy(true); setPingMsg(null);
    try {
      const url = serverUrl.trim().replace(/\/$/, '');
      if (!url) throw new Error('请填写服务器地址');
      if (isElectron) await api.setServerUrl(url);
      const r: any = await api.pingServer();
      setPingMsg({ ok: !!r.ok, text: r.ok ? `连接成功 ${r.url}` : `连接失败 ${r.url}` });
      setServerTested(!!r.ok);
      if (r.ok) {
        // 拉取门店列表用于设备绑定（首次绑定时本地缓存为空，必须从服务器取）
        const s: any = isElectron
          ? await (await fetch(`${url}/api/device/stores`)).json()
          : await api.getStores();
        setStores(s || []);
      }
    } catch (e: any) {
      setPingMsg({ ok: false, text: e.message || '连接失败' });
      setServerTested(false);
    } finally {
      setPingBusy(false);
    }
  }

  async function submit() {
    setErr(''); setBusy(true);
    try {
      if (!serverTested) throw new Error('请先测试服务器连接');
      if (!storeCode || !deviceCode) throw new Error('请选择门店并填写设备编码');
      const identity = await api.registerDevice({ password, storeCode, deviceCode, displayName });
      notifyDeviceChanged(identity);
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
        {/* Step 1: cloud server address */}
        <div className="mb-5 space-y-3 border-b border-slate-200 pb-5">
          <p className="text-sm font-medium text-ink-700">第 1 步：连接云端服务器</p>
          <Field label="服务器地址" required hint="如 https://your.domain.com （注意 https）">
            <Input
              value={serverUrl}
              onChange={(e) => { setServerUrl(e.target.value); setServerTested(false); setPingMsg(null); }}
              placeholder="https://clinic.example.com"
              disabled={pingBusy}
            />
          </Field>
          <Button variant="ghost" onClick={testServer} disabled={pingBusy || !serverUrl.trim()}>
            {pingBusy ? '测试中…' : '测试连接'}
          </Button>
          {pingMsg && (
            <div className={`rounded-md px-3 py-2 text-sm ${pingMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {pingMsg.text}
            </div>
          )}
        </div>

        {/* Step 2: bind to store */}
        <p className="mb-4 text-sm text-ink-500">
          请填写后台密码和门店信息完成设备绑定。绑定后该设备产生的所有记录将自动带上此门店标签。
        </p>
        <div className={`space-y-3 ${!serverTested ? 'pointer-events-none opacity-50' : ''}`}>
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
          <Button className="w-full" disabled={busy || !serverTested} onClick={submit}>
            {busy ? '绑定中…' : '绑定设备'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
