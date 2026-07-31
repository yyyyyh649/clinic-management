// 修改密码 (spec F): change the backend login password and/or the sensitive-info
// password directly from the admin UI — no .env edit, no restart.
//
// Both passwords are stored bcrypt-hashed in the DB. Changing either requires
// entering the *current* password first. Changing the backend password also
// invalidates all existing sessions (including this one) — the user must log
// in again with the new password.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';
import { Card, Button, Field, Input } from '../components/ui';

type Key = 'BACKEND' | 'CHANGE';

const META: Record<Key, { title: string; label: string; desc: string }> = {
  BACKEND: {
    title: '后台登录密码',
    label: '后台登录 / 新设备绑定用的密码',
    desc: '修改后当前登录状态会立即失效，所有设备需用新密码重新登录/绑定。',
  },
  CHANGE: {
    title: '敏感信息修改密码',
    label: '修改手机号 / 历史记录时二次确认用的密码',
    desc: '修改后下次修改敏感信息时使用新密码。',
  },
};

export default function ChangePassword() {
  const nav = useNavigate();
  const [form, setForm] = useState<Record<Key, { current: string; next: string; confirm: string }>>({
    BACKEND: { current: '', next: '', confirm: '' },
    CHANGE: { current: '', next: '', confirm: '' },
  });
  const [busy, setBusy] = useState<Key | null>(null);
  const [msg, setMsg] = useState<Record<Key, string>>({ BACKEND: '', CHANGE: '' });
  const [err, setErr] = useState<Record<Key, string>>({ BACKEND: '', CHANGE: '' });

  function set(key: Key, field: 'current' | 'next' | 'confirm', v: string) {
    setForm((f) => ({ ...f, [key]: { ...f[key], [field]: v } }));
    setErr((e) => ({ ...e, [key]: '' }));
    setMsg((m) => ({ ...m, [key]: '' }));
  }

  async function submit(key: Key) {
    const f = form[key];
    setErr((e) => ({ ...e, [key]: '' }));
    setMsg((m) => ({ ...m, [key]: '' }));
    if (!f.current) { setErr((e) => ({ ...e, [key]: '请输入当前密码' })); return; }
    if (!f.next) { setErr((e) => ({ ...e, [key]: '请输入新密码' })); return; }
    if (f.next === f.current) { setErr((e) => ({ ...e, [key]: '新密码不能与当前密码相同' })); return; }
    if (f.next !== f.confirm) { setErr((e) => ({ ...e, [key]: '两次输入的新密码不一致' })); return; }
    setBusy(key);
    try {
      await api.changePassword(key, f.current, f.next);
      setForm((s) => ({ ...s, [key]: { current: '', next: '', confirm: '' } }));
      if (key === 'BACKEND') {
        // Changing the backend password invalidates all sessions — force re-login.
        setMsg((m) => ({ ...m, [key]: '后台密码已修改，当前登录状态已失效，即将跳转登录页…' }));
        setToken(null);
        setTimeout(() => nav('/'), 1500);
      } else {
        setMsg((m) => ({ ...m, [key]: '敏感信息修改密码已修改。' }));
      }
    } catch (e: any) {
      setErr((er) => ({ ...er, [key]: e.message || '修改失败' }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card title="修改密码" extra={<span className="text-xs text-ink-500">密码加密存储，改完无需重启服务</span>}>
        <p className="mb-2 text-sm text-ink-500">
          两种密码分开修改，都需要先输入当前密码验证通过后才能设置新密码。密码在数据库中加密存储，不在前端明文展示。
        </p>
      </Card>

      {(['BACKEND', 'CHANGE'] as Key[]).map((key) => {
        const m = META[key];
        const f = form[key];
        return (
          <Card key={key} title={m.title}>
            <p className="mb-3 text-xs text-ink-500">{m.label}。{m.desc}</p>
            <div className="space-y-3">
              <Field label="当前密码" required>
                <Input type="password" value={f.current} onChange={(e) => set(key, 'current', e.target.value)} placeholder="请输入当前密码" />
              </Field>
              <Field label="新密码" required>
                <Input type="password" value={f.next} onChange={(e) => set(key, 'next', e.target.value)} placeholder="请输入新密码" />
              </Field>
              <Field label="确认新密码" required>
                <Input type="password" value={f.confirm} onChange={(e) => set(key, 'confirm', e.target.value)} placeholder="再次输入新密码" />
              </Field>
              {err[key] && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{err[key]}</div>}
              {msg[key] && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg[key]}</div>}
              <div className="flex justify-end">
                <Button disabled={busy !== null} onClick={() => submit(key)}>
                  {busy === key ? '修改中…' : `修改${m.title}`}
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
