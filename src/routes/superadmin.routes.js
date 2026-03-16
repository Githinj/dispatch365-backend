import { Router } from 'express'
import { authenticate } from '../middleware/auth.middleware.js'
import { requireRole }  from '../middleware/role.middleware.js'
import { auditLog }     from '../middleware/audit.middleware.js'
import {
  getPlatformStatsHandler,
  listAuditLogsHandler,
  getAuditLogHandler,
  listPlatformSettingsHandler,
  updatePlatformSettingHandler,
  listPlanConfigsHandler,
  updatePlanConfigHandler,
  listActiveSessionsHandler,
  forceLogoutHandler,
  listFlaggedRatingsHandler,
  removeFlaggedRatingHandler,
  createAgencyHandler
} from '../controllers/superadmin.controller.js'

const router = Router()

// All routes in this module are SUPER_ADMIN only
router.use(authenticate)
router.use(requireRole('SUPER_ADMIN'))

// ─── Platform overview ────────────────────────────────────────
router.get('/stats', getPlatformStatsHandler)

// ─── Audit logs (read-only — immutable) ──────────────────────
router.get('/audit-logs',     listAuditLogsHandler)
router.get('/audit-logs/:id', getAuditLogHandler)

// ─── Platform settings ────────────────────────────────────────
router.get('/settings', listPlatformSettingsHandler)
router.patch('/settings/:key',
  auditLog({ action: 'UPDATE', entity: 'PlatformSettings' }),
  updatePlatformSettingHandler
)

// ─── Subscription plan configs ────────────────────────────────
router.get('/plan-configs', listPlanConfigsHandler)
router.patch('/plan-configs/:plan',
  auditLog({ action: 'UPDATE', entity: 'SubscriptionPlanConfig' }),
  updatePlanConfigHandler
)

// ─── Active sessions / force logout ──────────────────────────
router.get('/sessions', listActiveSessionsHandler)
router.delete('/sessions/:id',
  auditLog({ action: 'FORCE_LOGOUT', entity: 'Session' }),
  forceLogoutHandler
)

// ─── Flagged dispatcher ratings ───────────────────────────────
router.get('/flagged-ratings', listFlaggedRatingsHandler)
router.delete('/flagged-ratings/:id',
  auditLog({ action: 'REMOVE', entity: 'DispatcherRating' }),
  removeFlaggedRatingHandler
)

// ─── Agencies ─────────────────────────────────────────────────
router.post('/agencies',
  auditLog({ action: 'CREATE', entity: 'Agency' }),
  createAgencyHandler
)

export default router
