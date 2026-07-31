// A: Backend admin embedded in the front-desk Electron app.
//
// The same server admin SPA the browser uses is loaded in an <iframe> with a
// ?token=<token> query param, which the SPA consumes to auto-login (see
// server/web/src/App.tsx). This way there is ONE admin codebase shared by both
// the Electron entry and the remote browser entry — no duplicate maintenance.
//
// Re-entering /admin always shows the password gate first (state lives in the
// component, not a global), so an unattended front-desk PC can't be peeked into.
import { useState } from 'react';
import { api, isElectron } from '../api';
import { Button, Field, Input } from '../components/ui';

export default function Admin() {
  // Token lives in component state only — leaving /admin and coming back
  // re-mounts the component and forces the password gate again (spec A).
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string>('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!isElectron) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md text-center text-sm text-ink-600">
          后台管理仅在桌面客户端内可用。如需远程查看，请用浏览器直接访问服务器地址
          <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5">http://&lt;服务器IP&gt;:4000/</code>。
        </div>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!password) { setErr('请输入后台密码'); return; }
    setBusy(true);
    try {
      const r = await api.adminLogin(password);
      setToken(r.token);
      setServerUrl(r.serverUrl);
      setPassword('');
    } catch (e: any) {
      setErr(e.message || '登录失败');
    } finally {
      setBusy(false);
    }
  }

  if (token) {
    // The admin SPA reads ?token= on load, auto-logs-in, then strips it from the URL.
    // Use a key so re-login after logout (token cleared) reloads the iframe fresh.
    const src = `${serverUrl}/?token=${encodeURIComponent(token)}#/`;
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
          <span className="text-xs text-ink-500">已进入后台管理 · 数据来自云端服务器</span>
          <div className="flex items-center gap-2">
            <a
              className="text-xs text-brand-600 hover:underline"
              href={`${serverUrl}/?token=${encodeURIComponent(token)}#/`}
              target="_blank"
              rel="noreferrer"
            >
              在浏览器中打开 ↗
            </a>
            <Button size="sm" variant="subtle" onClick={() => { setToken(null); }}>
              退出后台
            </Button>
          </div>
        </div>
        <iframe
          key={token}
          src={src}
          title="后台管理"
          className="flex-1 border-0 bg-white"
          // Allow the admin SPA's charts, inputs, modals to work normally.
          // No allow-popups/allow-downloads here; downloads are handled by the
          // admin SPA's own export endpoints opened in a new tab via target=_blank.
        />
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-ink-900">后台管理</h2>
        <p className="mt-1 text-xs text-ink-500">
          输入后台密码进入。每次进入都需要重新验证，避免无人值守时被随意查看营业额等敏感数据。
        </p>
        <div className="mt-4">
          <Field label="后台密码" required error={err}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入后台登录密码"
              autoFocus
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={busy}>{busy ? '验证中…' : '进入后台'}</Button>
        </div>
        <p className="mt-3 text-xs text-ink-400">
          忘记密码？需在服务器上重置：删除数据库 Password 表中对应行后，在 <code className="rounded bg-slate-100 px-1">packages/server/.env</code> 配置新的初始密码并重启服务（仅此一次，之后改密码走后台界面）。
        </p>
      </form>
    </div>
  );
}
