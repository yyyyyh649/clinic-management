// Auth middleware + routes: DB-backed bcrypt passwords (spec F + B.8).
// Backend login + device-bind use the BACKEND password; sensitive edits use CHANGE.
import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '@clinic/shared';
import { createSession, isValidSession, revokeSession } from './config.js';
import { backendFingerprint, changePassword, invalidateFingerprintCache, verifyPassword, PASSWORD_KEY } from './passwords.js';
import { ah } from './util.js';

// Every business/statistics API sits behind this. Tokens are HMAC-signed and
// keyed to the current backend-password fingerprint, so they survive restarts
// but die instantly when the backend password changes.
export function makeRequireBackend(prisma: PrismaClient) {
  return async function requireBackend(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.headers['x-backend-token'] as string | undefined;
      const fp = await backendFingerprint(prisma);
      if (isValidSession(token, fp)) return next();
      return res.status(401).json({ error: '未登录或会话已过期' });
    } catch (e) {
      return next(e);
    }
  };
}

export function makeAuthRoutes(prisma: PrismaClient) {
  return (router: import('express').Router) => {
    // Login with the shared backend password (verified against the DB hash).
    router.post('/login', ah(async (req, res) => {
      const { password } = req.body || {};
      const ok = await verifyPassword(prisma, PASSWORD_KEY.BACKEND, password || '');
      if (!ok) return res.status(401).json({ error: '密码错误' });
      const { token, expiresAt } = createSession(await backendFingerprint(prisma));
      return res.json({ token, expiresAt });
    }));

    router.post('/logout', (req, res) => {
      const token = req.headers['x-backend-token'] as string | undefined;
      if (token) revokeSession(token);
      return res.json({ ok: true });
    });

    router.get('/session', ah(async (req, res) => {
      const token = req.headers['x-backend-token'] as string | undefined;
      return res.json({ valid: isValidSession(token, await backendFingerprint(prisma)) });
    }));

    // Verify the sensitive-edit password (CHANGE). Returns ok/denied.
    router.post('/verify-change', ah(async (req, res) => {
      const { password } = req.body || {};
      const ok = await verifyPassword(prisma, PASSWORD_KEY.CHANGE, password || '');
      return res.json({ ok });
    }));

    // Change a password. Requires current password verification first (spec F).
    // Changing the BACKEND password rotates the session fingerprint, which
    // invalidates all outstanding tokens everywhere (including this caller's).
    router.post('/change-password', ah(async (req, res) => {
      const { key, current, next } = req.body || {};
      if (key !== PASSWORD_KEY.BACKEND && key !== PASSWORD_KEY.CHANGE) {
        return res.status(400).json({ error: '无效的密码类型' });
      }
      try {
        await changePassword(prisma, key, current || '', next || '');
        if (key === PASSWORD_KEY.BACKEND) invalidateFingerprintCache();
        return res.json({ ok: true });
      } catch (e: any) {
        return res.status(400).json({ error: e.message || '修改失败' });
      }
    }));
  };
}
