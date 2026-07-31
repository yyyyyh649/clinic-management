// Auth middleware + routes: DB-backed bcrypt passwords (spec F + B.8).
// Backend login + device-bind use the BACKEND password; sensitive edits use CHANGE.
import type { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '@clinic/shared';
import { createSession, isValidSession, revokeSession, invalidateAllSessions } from './config.js';
import { verifyPassword, changePassword, PASSWORD_KEY } from './passwords.js';

export function requireBackend(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['x-backend-token'] as string | undefined;
  if (isValidSession(token)) return next();
  return res.status(401).json({ error: '未登录或会话已过期' });
}

export function makeAuthRoutes(prisma: PrismaClient) {
  return (router: import('express').Router) => {
    // Login with the shared backend password (verified against the DB hash).
    router.post('/login', async (req, res) => {
      const { password } = req.body || {};
      const ok = await verifyPassword(prisma, PASSWORD_KEY.BACKEND, password || '');
      if (!ok) return res.status(401).json({ error: '密码错误' });
      const { token, expiresAt } = createSession();
      return res.json({ token, expiresAt });
    });

    router.post('/logout', (req, res) => {
      const token = req.headers['x-backend-token'] as string | undefined;
      if (token) revokeSession(token);
      return res.json({ ok: true });
    });

    router.get('/session', (req, res) => {
      const token = req.headers['x-backend-token'] as string | undefined;
      return res.json({ valid: isValidSession(token) });
    });

    // Verify the sensitive-edit password (CHANGE). Returns ok/denied.
    router.post('/verify-change', async (req, res) => {
      const { password } = req.body || {};
      const ok = await verifyPassword(prisma, PASSWORD_KEY.CHANGE, password || '');
      return res.json({ ok });
    });

    // Change a password. Requires current password verification first (spec F).
    // Changing the BACKEND password invalidates all existing sessions, so the
    // current login (and every device-bind that re-checks) must use the new one.
    router.post('/change-password', async (req, res) => {
      const { key, current, next } = req.body || {};
      if (key !== PASSWORD_KEY.BACKEND && key !== PASSWORD_KEY.CHANGE) {
        return res.status(400).json({ error: '无效的密码类型' });
      }
      try {
        await changePassword(prisma, key, current || '', next || '');
        if (key === PASSWORD_KEY.BACKEND) {
          // Force re-login everywhere (including the caller) with the new password.
          invalidateAllSessions();
        }
        return res.json({ ok: true });
      } catch (e: any) {
        return res.status(400).json({ error: e.message || '修改失败' });
      }
    });

    // Device registration pre-check: requires the BACKEND password (DB-verified).
    // Actual device/store upsert is handled in sync.ts; here we just validate.
    router.post('/device/register', async (req, res) => {
      const { password, storeCode, deviceCode, displayName } = req.body || {};
      const ok = await verifyPassword(prisma, PASSWORD_KEY.BACKEND, password || '');
      if (!ok) return res.status(401).json({ error: '后台密码错误，无法注册设备' });
      return res.json({ ok: true, storeCode, deviceCode, displayName });
    });
  };
}
