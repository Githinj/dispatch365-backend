import { prisma } from '../services/prisma.service.js'

/**
 * Removes expired and long-dead inactive sessions from the DB.
 * - Expired: expiresAt < now (regardless of isActive flag)
 * - Stale inactive: isActive=false AND expiresAt < 7 days ago (keep recent logouts briefly for audit trails)
 */
export async function runSessionCleanupJob() {
  const now        = new Date()
  const staleLimit = new Date(now)
  staleLimit.setDate(staleLimit.getDate() - 7)

  const { count } = await prisma.session.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { isActive: false, expiresAt: { lt: staleLimit } }
      ]
    }
  })

  if (count > 0) {
    console.log(`[Job:sessionCleanup] Deleted ${count} expired/stale session(s)`)
  }
}
