// Server configuration. NO password/secret is hardcoded here (spec B.8 / F).
// Passwords live in the DB (bcrypt-hashed); see passwords.ts. .env values are
// only initial seeds used once on first boot.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader: reads packages/server/.env if present and populates
// process.env for any keys NOT already set (so systemd EnvironmentFile / real
// env vars always win). This makes the documented "create .env" workflow
// actually function for both `npm run dev` and `npm run start` without needing
// the dotenv package. Runs before `config` is built below.
const envFile = path.resolve(__dirname, fs.existsSync(path.resolve(__dirname, '../.env')) ? '../.env' : '../../../.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

export const config = {
  port: Number(process.env.PORT || 4000),
  // Token signing secret: if not in .env, generate a random one per process
  // (sessions are in-memory & short-lived anyway). NEVER a hardcoded default.
  tokenSecret: process.env.CLINIC_TOKEN_SECRET || crypto.randomUUID(),
  // server.db lives at packages/server/server.db in BOTH dev and prod.
  // dev:  __dirname = packages/server/src            -> ../server.db = packages/server/server.db
  // prod: __dirname = packages/server/dist/server/src -> ../../../server.db = packages/server/server.db
  dbUrl: process.env.DATABASE_URL || `file:${path.resolve(__dirname, fs.existsSync(path.resolve(__dirname, '../server.db')) ? '../server.db' : '../../../server.db')}`,
};

// HMAC-signed, stateless admin session tokens. Format:
//   `${expiresAtMs}.${nonce}.${sig}`
// where sig = HMAC_SHA256(tokenSecret, `${expiresAtMs}.${nonce}.${pwFingerprint}`).
//
// - pwFingerprint = sha256 of the CURRENT backend password hash, so changing the
//   backend password invalidates every outstanding token automatically (spec F),
//   even across process restarts.
// - Tokens survive server restarts (no in-memory session map to lose).
// - logout is a best-effort in-memory revocation set (a restart clears it, which
//   is acceptable: tokens are short-lived and password change is the hard kill).
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h
const revoked = new Set<string>();

function sign(expiresAt: string, nonce: string, fingerprint: string): string {
  return crypto.createHmac('sha256', config.tokenSecret)
    .update(`${expiresAt}.${nonce}.${fingerprint}`)
    .digest('hex');
}

export function createSession(fingerprint: string): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const nonce = crypto.randomUUID();
  const sig = sign(String(expiresAt), nonce, fingerprint);
  return { token: `${expiresAt}.${nonce}.${sig}`, expiresAt };
}

export function isValidSession(token: string | null | undefined, fingerprint: string): boolean {
  if (!token || revoked.has(token)) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = sign(expStr, nonce, fingerprint);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function revokeSession(token: string) { revoked.add(token); }
