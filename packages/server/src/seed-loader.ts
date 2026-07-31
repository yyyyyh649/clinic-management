// Auto-seed the server.db if it has no config records yet.
import type { PrismaClient } from '@clinic/shared';
import { runSeed } from '@clinic/shared';

export async function seedIfEmpty(prisma: PrismaClient): Promise<void> {
  const storeCount = await prisma.store.count();
  if (storeCount === 0) {
    console.log('[server] db empty, seeding config…');
    await runSeed(prisma);
  }
}
