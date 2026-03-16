import { prisma } from '../services/prisma.service.js'

/**
 * auditLog — Middleware #5 in the stack (after route handler).
 *
 * Usage in routes:
 *   router.post('/loads', authenticate, requireRole('DISPATCHER'), enforceAgencyIsolation,
 *     enforceFinancialVisibility, auditLog({ action: 'CREATE', entity: 'Load' }), handler)
 *
 * Works by overriding res.json() — writes audit record AFTER successful response (2xx only).
 * Failure of audit log never breaks the response.
 *
 * For complex multi-step operations, call writeAuditLog() directly from the service layer.
 */
export function auditLog({ action, entity, getEntityId, description }) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res)

    res.json = function (body) {
      // Only audit successful mutations (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const entityId = getEntityId ? getEntityId(req, body) : (body?.data?.id ?? req.params?.id ?? null)

        writeAuditLog({
          actorId:    req.user?.id,
          actorRole:  req.user?.role,
          actorEmail: req.user?.email,
          actionType: action,
          description: description ?? `${action} ${entity}`,
          entityType: entity,
          entityId,
          newValue:   body?.data ?? null,
          ipAddress:  req.ip,
          deviceInfo: req.headers['user-agent'],
          agencyId:   req.isolation?.agencyId ?? req.user?.agencyId ?? null,
          impersonatedBySuperAdminId: req.impersonatorId ?? null
        }).catch(err => console.error('[AuditLog] Failed to write:', err.message))
      }

      return originalJson(body)
    }

    next()
  }
}

/**
 * writeAuditLog — Call directly from service layer for complex operations.
 * AUDIT LOGS ARE IMMUTABLE — no update or delete. Ever.
 */
export async function writeAuditLog({
  actorId,
  actorRole,
  actorEmail,
  actionType,
  description,
  entityType,
  entityId = null,
  oldValue = null,
  newValue = null,
  ipAddress = null,
  deviceInfo = null,
  agencyId = null,
  impersonatedBySuperAdminId = null
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId,
        actorRole,
        actorEmail,
        actionType,
        description,
        entityType,
        entityId,
        oldValue:  oldValue  ? JSON.parse(JSON.stringify(oldValue))  : null,
        newValue:  newValue  ? JSON.parse(JSON.stringify(newValue))  : null,
        ipAddress,
        deviceInfo,
        agencyId,
        impersonatedBySuperAdminId
      }
    })
  } catch (err) {
    // Never throw — audit failure must not break business operations
    console.error('[AuditLog] Write failed:', err.message)
  }
}
