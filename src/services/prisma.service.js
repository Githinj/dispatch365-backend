import { PrismaClient } from '@prisma/client'

// Singleton Prisma client — reuse across all modules
const globalForPrisma = globalThis

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
