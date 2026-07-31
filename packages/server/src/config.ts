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

// In-memory admin sessions (token -> { expiry, generation }). Simple, single-process.
// `generation` ties a session to a password-generation so changing the backend
// password can invalidate all outstanding sessions at once (spec F).
const sessions = new Map<string, { expiresAt: number; generation: number }>();
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h
let sessionGeneration = 0;

export function currentSessionGeneration(): number {
  return sessionGeneration;
}

export function createSession(): { token: string; expiresAt: number } {
  const token = `${Date.now()}-${crypto.randomUUID()}`;
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { expiresAt, generation: sessionGeneration });
  return { token, expiresAt };
}

export function isValidSession(token?: string | null): boolean {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (s.expiresAt < Date.now()) { sessions.delete(token); return false; }
  // Session from an older password-generation is no longer valid.
  if (s.generation !== sessionGeneration) { sessions.delete(token); return false; }
  return true;
}

export function revokeSession(token: string) { sessions.delete(token); }

// Invalidate every outstanding session (used after the backend password changes).
export function invalidateAllSessions(): void {
  sessionGeneration++;
  sessions.clear();
}
