/**
 * Prisma Client Singleton
 * Prevents multiple instances in Next.js hot-reload dev mode
 * Prisma v7 — uses @prisma/adapter-pg with pg Pool
 */

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

type PrismaClientType = InstanceType<typeof PrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientType | undefined;
  pool: Pool | undefined;
};

function createPrismaClient(): PrismaClientType {
  // Reuse the pool across hot reloads so it's never garbage-collected
  // while the Prisma client still holds a reference to it.
  if (!globalForPrisma.pool) {
    globalForPrisma.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }
  const adapter = new PrismaPg(globalForPrisma.pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export const prisma: PrismaClientType =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
