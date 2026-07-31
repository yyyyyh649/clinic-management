// Server entry: Express API + audit logging + static admin SPA.
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { prisma, initDb } from './db.js';
import { makeAuthRoutes, requireBackend } from './auth.js';
import { syncRouter } from './sync.js';
import { configRouter } from './routes/config.js';
import { memberRouter } from './routes/members.js';
import { examRouter } from './routes/exams.js';
import { paymentRouter } from './routes/payments.js';
import { statsRouter } from './routes/stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(morgan('tiny'));

// ---- Audit logging middleware (records mutating calls) ----
app.use('/api', async (req, _res, next) => {
  if (req.method === 'GET' || req.path.startsWith('/sync/') || req.path.startsWith('/auth/')) return next();
  try {
    const seg = req.path.split('/').filter(Boolean);
    const entityType = seg[0] ? seg[0].replace(/s$/, '') : 'unknown';
    await prisma.auditLog.create({
      data: {
        action: req.method === 'POST' ? 'CREATE' : req.method === 'PUT' || req.method === 'PATCH' ? 'UPDATE' : 'DELETE',
        entityType, entityId: seg[1] || null,
        details: JSON.stringify({ path: req.path, body: req.body }).slice(0, 4000),
        operatorId: req.body?.operatorId || req.headers['x-operator-id'] || null,
        operatorName: req.body?.operatorName || req.headers['x-operator-name'] || '前台',
        storeId: req.body?.storeId || null, deviceId: req.body?.deviceId || null,
      },
    }).catch(() => {});
  } catch { /* audit must never break requests */ }
  next();
});

// ---- Public API (front-desk daily use + sync + auth) ----
app.use('/api', syncRouter);            // /api/device/register, /api/push, /api/pull, /api/ping
const authRouter = express.Router();
makeAuthRoutes(prisma)(authRouter);
app.use('/api/auth', authRouter);
app.use('/api/members', memberRouter);  // incl. /customers/dedup, /search (open for front desk)
app.use('/api/exams', examRouter);
app.use('/api/payments', paymentRouter);

// ---- Backend-gated API (财务/配置类, requires shared password) ----
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

async function start() {
  await initDb();
  app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
  });
}
start().catch((e) => { console.error(e); process.exit(1); });
