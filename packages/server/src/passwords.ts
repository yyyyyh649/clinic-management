// DB-backed, bcrypt-hashed passwords (spec F + B.8).
//
// .env values are ONLY the *initial* passwords, used exactly once on first boot
// to seed the DB rows (when no row exists yet). After that, passwords live in
// the Password table and are changed via the admin UI — no .env edit, no restart.
//
// If .env does NOT provide an initial password AND the DB row is missing, the
// server refuses to start (no silent hardcoded default — B.8).
//
// Keys:
//   BACKEND -> 后台登录 + 新设备绑定
//   CHANGE  -> 修改历史/敏感信息二次确认
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@clinic/shared';

export const PASSWORD_KEY = {
  BACKEND: 'BACKEND',
  CHANGE: 'CHANGE',
} as const;
export type PasswordKey = (typeof PASSWORD_KEY)[keyof typeof PASSWORD_KEY];

// Initial passwords come ONLY from env (no hardcoded fallback).
const ENV_INITIAL: Record<PasswordKey, string | undefined> = {
  BACKEND: process.env.CLINIC_BACKEND_PASSWORD,
  CHANGE: process.env.CLINIC_CHANGE_PASSWORD,
};
const LABEL: Record<PasswordKey, string> = {
  BACKEND: '后台登录/设备绑定密码 (CLINIC_BACKEND_PASSWORD)',
  CHANGE: '敏感信息修改密码 (CLINIC_CHANGE_PASSWORD)',
};
const ENV_HINT: Record<PasswordKey, string> = {
  BACKEND: 'CLINIC_BACKEND_PASSWORD',
  CHANGE: 'CLINIC_CHANGE_PASSWORD',
};

// Seed DB rows from env on first boot; fail if env is also missing.
export async function ensurePasswords(prisma: PrismaClient): Promise<void> {
  for (const key of [PASSWORD_KEY.BACKEND, PASSWORD_KEY.CHANGE] as PasswordKey[]) {
    const existing = await prisma.password.findUnique({ where: { key } });
    if (existing) continue;
    const initial = ENV_INITIAL[key];
    if (!initial) {
      throw new Error(
        `首次启动：数据库中未找到${LABEL[key]}，且 .env 未设置 ${ENV_HINT[key]}。\n` +
        `请在 packages/server/.env 中配置 ${ENV_HINT[key]}=<你的初始密码> 后再启动（首次启动后即可在后台界面修改，无需再碰 .env）。`,
      );
    }
    const hash = await bcrypt.hash(initial, 10);
    await prisma.password.create({ data: { key, hash } });
    console.log(`[server] 已从 .env 初始化${LABEL[key]}（之后可在后台修改，无需再改 .env/重启）。`);
  }
}

export async function verifyPassword(prisma: PrismaClient, key: PasswordKey, plaintext: string): Promise<boolean> {
  if (!plaintext) return false;
  const row = await prisma.password.findUnique({ where: { key } });
  if (!row) return false;
  return bcrypt.compare(plaintext, row.hash);
}

export async function changePassword(
  prisma: PrismaClient,
  key: PasswordKey,
  currentPlaintext: string,
  newPlaintext: string,
): Promise<void> {
  // Must verify the current password first — cannot skip (spec F).
  const ok = await verifyPassword(prisma, key, currentPlaintext);
  if (!ok) throw new Error('当前密码错误');
  if (!newPlaintext || newPlaintext.length < 1) throw new Error('新密码不能为空');
  if (newPlaintext === currentPlaintext) throw new Error('新密码不能与当前密码相同');
  const hash = await bcrypt.hash(newPlaintext, 10);
  await prisma.password.update({ where: { key }, data: { hash } });
}
