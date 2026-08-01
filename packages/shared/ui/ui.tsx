// Shared UI primitives — single source of truth for both the front-desk client
// and the admin web SPA. Both apps' components/ui.tsx re-export from here, so
// changes land once and reach both surfaces (prevents the drift that previously
// left Modal.wide on one side only).
//
// Consumed as SOURCE via relative re-export (not through the shared barrel,
// which re-exports Prisma and breaks the browser bundle). Vite resolves the
// .tsx natively; the client tsconfig (jsx: react-jsx) type-checks it.
import React from 'react';
// 元转分等纯函数统一走 @clinic/shared/constants 这一个入口（避免各页面手写
// Math.round(parseFloat(x)*100) 重复实现）。constants.ts 不引入 Prisma。
export { parseYuanToCents } from '../src/constants.js';

export function Button({
  variant = 'primary', size, className, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'subtle'; size?: 'sm' | 'md' }) {
  const cls = variant === 'primary' ? 'btn-primary'
    : variant === 'ghost' ? 'btn-ghost'
    : variant === 'danger' ? 'btn-danger'
    : 'btn bg-slate-100 text-ink-700 hover:bg-slate-200';
  return <button className={`${cls} ${size === 'sm' ? 'px-2 py-1 text-xs' : ''} ${className || ''}`} {...props} />;
}

export function Field({ label, required, error, hint, children }: {
  label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...p }, ref) {
    return <input ref={ref} className={`input ${className || ''}`} {...p} />;
  },
);

export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`input ${className || ''}`} {...p}>{children}</select>;
}

export function TextArea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`input ${className || ''}`} {...p} />;
}

export function Card({ title, extra, children, className }: {
  title?: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`card ${className || ''}`}>
      {(title || extra) && (
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="text-sm font-semibold text-ink-900">{title}</div>
          <div>{extra}</div>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Badge({ tone = 'slate', children }: { tone?: 'slate' | 'amber' | 'rose' | 'green' | 'blue'; children: React.ReactNode }) {
  const cls = {
    slate: 'bg-slate-100 text-slate-700',
    amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-700',
    green: 'bg-emerald-100 text-emerald-700',
    blue: 'bg-brand-50 text-brand-700',
  }[tone];
  return <span className={`badge ${cls}`}>{children}</span>;
}

export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose?: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-lg bg-white shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
          {onClose && <button onClick={onClose} className="text-ink-500 hover:text-ink-900">×</button>}
        </div>
        <div className="max-h-[70vh] overflow-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="py-12 text-center text-sm text-ink-500">{text}</div>;
}

// cents -> "12.34"
export function fmtCents(c: number | null | undefined): string {
  if (c === null || c === undefined || Number.isNaN(c)) return '0.00';
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(Math.round(c));
  return `${sign}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}`;
}
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '';
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '';
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}
