import { prisma } from './prisma.service.js'
import { sessionService } from './redis.service.js'
import { writeAuditLog } from '../middleware/audit.middleware.js'
import { removeRating } from './dispatcher.service.js'

// ─── Platform Stats ────────────────────────────────────────────
export async function getPlatformStats() {
  const [
    totalAgencies,
    activeAgencies,
    suspendedAgencies,
    totalFleets,
    totalDispatchers,
    totalDrivers,
    totalVehicles,
    totalLoads,
    loadsByStatus,
    totalInvoices,
    unpaidInvoices,
    overdueInvoices
  ] = await Promise.all([
    prisma.agency.count(),
    prisma.agency.count({ where: { status: 'ACTIVE' } }),
    prisma.agency.count({ where: { status: 'SUSPENDED' } }),
    prisma.fleet.count(),
    prisma.dispatcher.count(),
    prisma.driver.count(),
    prisma.vehicle.count(),
    prisma.load.count(),
    prisma.load.groupBy({ by: ['status'], _count: { id: true } }),
    prisma.invoice.count(),
    prisma.invoice.count({ where: { status: 'UNPAID' } }),
    prisma.invoice.count({ where: { status: 'OVERDUE' } })
  ])

  // Sum all-time fleet earnings from paid invoices
  const revenueAgg = await prisma.invoice.aggregate({
    where: { status: 'PAID' },
    _sum:  { commissionAmount: true, fleetEarnings: true, loadRate: true }
  })

  const loadStatusMap = Object.fromEntries(
    loadsByStatus.map(({ status, _count }) => [status, _count.id])
  )

  return {
    agencies: { total: totalAgencies, active: activeAgencies, suspended: suspendedAgencies },
    fleets:      { total: totalFleets },
    dispatchers: { total: totalDispatchers },
    drivers:     { total: totalDrivers },
    vehicles:    { total: totalVehicles },
    loads: {
      total: totalLoads,
      byStatus: loadStatusMap
    },
    invoices: {
      total: totalInvoices,
      unpaid: unpaidInvoices,
      overdue: overdueInvoices
    },
    revenue: {
      totalGrossLoadRate:   revenueAgg._sum.loadRate        ?? 0,
      totalCommission:      revenueAgg._sum.commissionAmount ?? 0,
      totalFleetEarnings:   revenueAgg._sum.fleetEarnings    ?? 0
    }
  }
}

// ─── List Audit Logs ───────────────────────────────────────────
export async function listAuditLogs({ page = 1, perPage = 50, entityType, actorRole, agencyId, entityId } = {}) {
  const skip  = (page - 1) * perPage
  const where = {}

  if (entityType) where.entityType = entityType
  if (actorRole)  where.actorRole  = actorRole
  if (agencyId)   where.agencyId   = agencyId
  if (entityId)   where.entityId   = entityId

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take:    perPage,
      orderBy: { timestamp: 'desc' }
    }),
    prisma.auditLog.count({ where })
  ])

  return { data: logs, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } }
}

// ─── Get Audit Log ─────────────────────────────────────────────
export async function getAuditLog(logId) {
  return prisma.auditLog.findUnique({ where: { id: logId } })
}

// ─── List Platform Settings ────────────────────────────────────
export async function listPlatformSettings() {
  return prisma.platformSettings.findMany({ orderBy: { key: 'asc' } })
}

// ─── Update Platform Setting ───────────────────────────────────
export async function updatePlatformSetting(key, value, { actorId, actorRole, actorEmail, ipAddress }) {
  const existing = await prisma.platformSettings.findUnique({ where: { key } })
  if (!existing) return { error: 'NOT_FOUND', message: `Setting "${key}" not found.` }

  const updated = await prisma.platformSettings.update({
    where: { key },
    data:  { value: String(value) }
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'UPDATE',
    description: `Platform setting "${key}" updated.`,
    entityType:  'PlatformSettings',
    entityId:    updated.id,
    oldValue:    { key, value: existing.value },
    newValue:    { key, value: String(value) },
    ipAddress
  })

  return { setting: updated }
}

// ─── List Subscription Plan Configs ───────────────────────────
export async function listPlanConfigs() {
  return prisma.subscriptionPlanConfig.findMany({ orderBy: { plan: 'asc' } })
}

// ─── Update Plan Config ────────────────────────────────────────
export async function updatePlanConfig(plan, data, { actorId, actorRole, actorEmail, ipAddress }) {
  const config = await prisma.subscriptionPlanConfig.findUnique({ where: { plan } })
  if (!config) return { error: 'NOT_FOUND', message: `Plan config for "${plan}" not found.` }

  const updated = await prisma.subscriptionPlanConfig.update({
    where: { plan },
    data
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'UPDATE',
    description: `Subscription plan config for "${plan}" updated.`,
    entityType:  'SubscriptionPlanConfig',
    entityId:    updated.id,
    oldValue:    config,
    newValue:    data,
    ipAddress
  })

  return { config: updated }
}

// ─── List Active Sessions ──────────────────────────────────────
export async function listActiveSessions({ page = 1, perPage = 50 } = {}) {
  const skip = (page - 1) * perPage

  const [sessions, total] = await Promise.all([
    prisma.session.findMany({
      where:   { isActive: true },
      skip,
      take:    perPage,
      orderBy: { lastActivityAt: 'desc' },
      select: {
        id: true, userId: true, userRole: true,
        ipAddress: true, deviceInfo: true,
        lastActivityAt: true, expiresAt: true, createdAt: true
      }
    }),
    prisma.session.count({ where: { isActive: true } })
  ])

  return { data: sessions, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } }
}

// ─── Force Logout ──────────────────────────────────────────────
// Deactivates a session in DB and destroys it in Redis.
export async function forceLogout(sessionId, { actorId, actorRole, actorEmail, ipAddress }) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } })

  if (!session)          return { error: 'NOT_FOUND',     message: 'Session not found.' }
  if (!session.isActive) return { error: 'ALREADY_ENDED', message: 'Session is not active.' }

  await prisma.session.update({ where: { id: sessionId }, data: { isActive: false } })
  await sessionService.destroy(session.userId)

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'FORCE_LOGOUT',
    description: `Session ${sessionId} force-terminated for user ${session.userId} (${session.userRole}).`,
    entityType:  'Session',
    entityId:    sessionId,
    oldValue:    { isActive: true },
    newValue:    { isActive: false },
    ipAddress
  })

  return { success: true }
}

// ─── List Flagged Ratings ──────────────────────────────────────
export async function listFlaggedRatings({ page = 1, perPage = 20 } = {}) {
  const skip = (page - 1) * perPage

  const [ratings, total] = await Promise.all([
    prisma.dispatcherRating.findMany({
      where:   { isFlagged: true, removedBySuperAdmin: false },
      skip,
      take:    perPage,
      orderBy: { flaggedAt: 'desc' },
      include: {
        dispatcher: { select: { id: true, name: true, email: true } },
        agency:     { select: { id: true, name: true } }
      }
    }),
    prisma.dispatcherRating.count({ where: { isFlagged: true, removedBySuperAdmin: false } })
  ])

  return { data: ratings, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } }
}

// ─── Remove Flagged Rating ─────────────────────────────────────
// Delegates to dispatcher.service.removeRating which handles recalcRating.
export async function removeFlaggedRating(ratingId, { reason, actorId, actorRole, actorEmail, ipAddress }) {
  const rating = await prisma.dispatcherRating.findUnique({ where: { id: ratingId } })

  if (!rating)          return { error: 'NOT_FOUND',    message: 'Rating not found.' }
  if (!rating.isFlagged) return { error: 'NOT_FLAGGED', message: 'This rating is not flagged.' }

  // removeRating handles the DB update + recalcRating atomically
  return removeRating(ratingId, { reason, actorId, actorEmail, ipAddress })
}
