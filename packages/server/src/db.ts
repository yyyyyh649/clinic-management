// Prisma instance + schema apply + seed on first boot.
import { PrismaClient } from '@clinic/shared';
import { config } from './config.js';
import { seedIfEmpty } from './seed-loader.js';
import { ensurePasswords } from './passwords.js';

// Ensure DATABASE_URL is set before instantiating PrismaClient (Prisma reads env at construct time).
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = config.dbUrl;
}

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function initDb() {
  // Apply schema (idempotent). prisma db push is a CLI; here we ensure tables exist via raw.
  // For server boot we rely on `npm run db:push` having been run. If the db is empty, seed.
  await seedIfEmpty(prisma);
  // Ensure DB-backed passwords exist (seed from .env on first boot; fail if both
  // missing — spec F/B.8). Must run after schema/seed so the Password table exists.
  await ensurePasswords(prisma);
  // Auto-apply bean expiry on boot (clear any due batches left over while offline).
  // (Anomaly recompute runs after each sync.)
}
