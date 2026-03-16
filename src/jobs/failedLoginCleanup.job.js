import { prisma } from '../services/prisma.service.js'

/**
 * Deletes failed login attempt records older than 24 hours.
 * The rate-limiter in redis.service.js already handles lockout windows;
 * this job keeps the failed_login_attempts table from growing unboundedly.
 */
export async function runFailedLoginCleanupJob() {
  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() - 24)

  const { count } = await prisma.failedLoginAttempt.deleteMany({
    where: { attemptedAt: { lt: cutoff } }
  })

  if (count > 0) {
    console.log(`[Job:failedLoginCleanup] Deleted ${count} old failed login attempt(s)`)
  }
}
