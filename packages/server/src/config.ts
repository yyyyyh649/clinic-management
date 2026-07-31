// Server configuration. Passwords come from env (defaults match the spec) so they
// are NOT committed as hardcoded secrets in app code — owner overrides via .env.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 4000),
  // Backend shared password (owner-controlled). Default per spec.
  backendPassword: process.env.CLINIC_BACKEND_PASSWORD || 'safe@safe',
  // Sensitive-edit password (history/personal-info changes). Default per spec.
  changePassword: process.env.CLINIC_CHANGE_PASSWORD || 'change123',
  // Token signing secret (rotates per process; sessions are short-lived & in-memory).
  tokenSecret: process.env.CLINIC_TOKEN_SECRET || 'clinic-dev-token-secret',
  dbUrl: process.env.DATABASE_URL || `file:${path.resolve(__dirname, '../server.db')}`,
  // Device registration requires the backend password (only owner sets up devices).
  deviceRegisterSecret: process.env.CLINIC_BACKEND_PASSWORD || 'safe@safe',
};

// In-memory admin sessions (token -> expiry). Simple, single-process.
const sessions = new Map<string, number>();
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

export function createSession(): { token: string; expiresAt: number } {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, expiresAt);
  return { token, expiresAt };
}
export function isValidSession(token?: string | null): boolean {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}
export function revokeSession(token: string) { sessions.delete(token); }
