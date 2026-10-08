import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// SECURITY: SQL query logging is DISABLED in production (queries can leak
// row data into logs). Dev keeps the verbose logging.
const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error', 'warn'],
  })

export const db = prisma

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db