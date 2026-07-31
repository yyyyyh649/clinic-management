// Auth middleware: backend shared-password session + sensitive-edit password.
import type { Request, Response, NextFunction } from 'express';
import { config, createSession, isValidSession, revokeSession } from './config.js';

export function requireBackend(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['x-backend-token'] as string | undefined;
  if (isValidSession(token)) return next();
  return res.status(401).json({ error: '未登录或会话已过期' });
}

export function makeAuthRoutes() {
  return (router: import('express').Router) => {
    // Login with shared backend password.
    router.post('/login', (req, res) => {
      const { password } = req.body || {};
      if (password !== config.backendPassword) {
        return res.status(401).json({ error: '密码错误' });
      }
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

    // Verify a sensitive-edit password (change123). Returns ok/denied; client also does二次确认.
    router.post('/verify-change', (req, res) => {
      const { password } = req.body || {};
      return res.json({ ok: password === config.changePassword });
    });

    // Device registration (front-desk device binds to a store). Requires backend password.
    router.post('/device/register', async (req, res) => {
      const { password, storeCode, deviceCode, displayName } = req.body || {};
      if (password !== config.deviceRegisterSecret) {
        return res.status(401).json({ error: '后台密码错误，无法注册设备' });
      }
      // dev note: actual device/store upsert handled in device routes; here just verify.
      return res.json({ ok: true, storeCode, deviceCode, displayName });
    });
  };
}
