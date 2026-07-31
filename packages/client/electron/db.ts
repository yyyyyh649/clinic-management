// Local SQLite (full cache) for the Electron front-desk device.
// On first launch: copy the shipped empty template DB (with schema) into userData, then seed config.
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { PrismaClient, runSeed } from '@clinic/shared';

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) throw new Error('local db not initialized');
  return prisma;
}

export async function initLocalDb(): Promise<PrismaClient> {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'client.db');
  // First launch: copy template (with schema) if no db yet.
  if (!fs.existsSync(dbPath)) {
    const templatePath = app.isPackaged
      ? path.join(process.resourcesPath, 'client.template.db')
      : path.join(__dirname, '../electron/resources/client.template.db');
    if (fs.existsSync(templatePath)) {
      fs.copyFileSync(templatePath, dbPath);
    }
  }
  process.env.DATABASE_URL = `file:${dbPath}`;
  prisma = new PrismaClient({ log: ['error'] });

  // Seed config if empty (so the device has stores/staff/tiers/templates/brands offline).
  const storeCount = await prisma.store.count();
  if (storeCount === 0) {
    await runSeed(prisma);
  }
  return prisma;
}
