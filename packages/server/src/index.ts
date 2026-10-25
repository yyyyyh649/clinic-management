// Server entry: Express API + audit logging + static admin SPA.
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { prisma, initDb } from './db.js';
import { makeAuthRoutes, makeRequireBackend } from './auth.js';
import { syncRouter } from './sync.js';
import { configRouter } from './routes/config.js';
import { memberRouter } from './routes/members.js';
import { examRouter } from './routes/exams.js';
import { paymentRouter } from './routes/payments.js';
import { statsRouter } from './routes/stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');

// CORS: the admin SPA is served same-origin; only localhost / LAN private
// origins are allowed cross-origin (Electron's node fetch sends no Origin and
// is always allowed).
const ALLOWED_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;
app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGIN.test(origin)) return cb(null, true);
    return cb(null, false);
  },
}));

// Sync push bodies can carry up to 1000 records; everything else stays small.
app.use('/api/push', express.json({ limit: '20mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

// Basic security headers (no CSP frame-ancestors: the Electron client embeds
// the admin SPA in a cross-origin iframe on purpose).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Rate limit the credential-checking endpoints (bcrypt slows brute force but
// does not stop it; these are shared passwords).
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { error: '尝试过于频繁，请 15 分钟后再试' },
});
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 120, // 敏感信息二次确认频率较高
  standardHeaders: true, legacyHeaders: false,
  message: { error: '尝试过于频繁，请稍后再试' },
});
app.use('/api/auth/login', credentialLimiter);
app.use('/api/auth/change-password', credentialLimiter);
app.use('/api/auth/verify-change', verifyLimiter);
app.use('/api/device/register', credentialLimiter);

// ---- Audit logging middleware (records mutating calls) ----
// Bodies are sanitized recursively: nothing matching password/secret/token is
// ever persisted (AuditLog syncs to every front-desk device, so a leaked
// credential here would be broadcast to the whole chain).
const SENSITIVE_KEY = /password|secret|token/i;
function sanitizeForAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForAudit);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : sanitizeForAudit(v);
    }
    return out;
  }
  return value;
}
app.use('/api', async (req, _res, next) => {
  if (req.method === 'GET') return next();
  // High-volume machine-to-machine traffic is excluded from the audit log.
  // (Paths here are relative to /api: the sync router mounts push/pull/ping
  // directly under /api, NOT under /api/sync/.)
  const p = req.path;
  if (p === '/push' || p === '/pull' || p === '/ping' || p.startsWith('/auth/')) return next();
  try {
    const seg = p.split('/').filter(Boolean);
    const entityType = seg[0] ? seg[0].replace(/s$/, '') : 'unknown';
    await prisma.auditLog.create({
      data: {
        action: req.method === 'POST' ? 'CREATE' : req.method === 'PUT' || req.method === 'PATCH' ? 'UPDATE' : 'DELETE',
        entityType, entityId: seg[1] || null,
        details: JSON.stringify({ path: p, body: sanitizeForAudit(req.body) }).slice(0, 4000),
        operatorId: req.body?.operatorId || req.headers['x-operator-id'] || null,
        operatorName: req.body?.operatorName || req.headers['x-operator-name'] || '前台',
        storeId: req.body?.storeId || null, deviceId: req.body?.deviceId || null,
      },
    }).catch(() => {});
  } catch { /* audit must never break requests */ }
  next();
});

// ---- Public API (front-desk device sync + auth) ----
app.use('/api', syncRouter);            // /api/device/*, /api/push, /api/pull, /api/ping
const authRouter = express.Router();
makeAuthRoutes(prisma)(authRouter);
app.use('/api/auth', authRouter);

// ---- Business API: requires a backend session token ----
const requireBackend = makeRequireBackend(prisma);
app.use('/api/members', requireBackend, memberRouter);
app.use('/api/exams', requireBackend, examRouter);
app.use('/api/payments', requireBackend, paymentRouter);

// ---- Backend-gated API (财务/配置类) ----
app.use('/api/config', requireBackend, configRouter);
app.use('/api/stats', requireBackend, statsRouter);

// ---- Serve admin SPA (built by vite into web/dist) ----
// dev:  __dirname = packages/server/src            -> ../web/dist
// prod: __dirname = packages/server/dist/server/src -> ../../../web/dist
const webDist = fs.existsSync(path.resolve(__dirname, '../web/dist'))
  ? path.resolve(__dirname, '../web/dist')
  : path.resolve(__dirname, '../../../web/dist');
app.use(express.static(webDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(webDist, 'index.html'), (err) => { if (err) next(); });
});

// ---- Global error handler (Express 4: async routes forward rejections here via `ah`) ----
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`[server] ${req.method} ${req.path} failed:`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: '服务器内部错误，请重试' });
});

async function start() {
  await initDb();
  app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
  });
}
start().catch((e) => { console.error(e); process.exit(1); });
