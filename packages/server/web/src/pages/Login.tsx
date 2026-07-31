import { useState } from 'react';
import { api, setToken } from '../api';
import { Button, Card, Field, Input } from '../components/ui';

export default function Login({ onOk }: { onOk: () => void }) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(''); setBusy(true);
    try {
      const r = await api.login(password);
      setToken(r.token);
      onOk();
    } catch (e: any) {
      setErr(e.message || '登录失败');
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Card className="w-full max-w-sm" title="后台登录">
        <p className="mb-4 text-sm text-ink-500">请输入后台共享密码。</p>
        <div className="space-y-3">
          <Field label="后台密码" required>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="safe@safe" />
          </Field>
          {err && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
          <Button className="w-full" disabled={busy} onClick={submit}>{busy ? '登录中…' : '登录'}</Button>
        </div>
      </Card>
    </div>
  );
}
