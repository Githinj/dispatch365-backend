import { z } from 'zod'
import { respond } from '../utils/respond.js'
import {
  getPlatformStats,
  listAuditLogs,
  getAuditLog,
  listPlatformSettings,
  updatePlatformSetting,
  listPlanConfigs,
  updatePlanConfig,
  listActiveSessions,
  forceLogout,
  listFlaggedRatings,
  removeFlaggedRating
} from '../services/superadmin.service.js'
import { createAgency } from '../services/agency.service.js'

// ─── Validation Schemas ───────────────────────────────────────

const updateSettingSchema = z.object({
  value: z.string().min(1)
}).strict()

const updatePlanConfigSchema = z.object({
  monthlyPrice:   z.number().positive().optional(),
  maxDispatchers: z.number().int().min(-1).optional(),
  description:    z.string().max(500).optional()
}).strict()

const removeRatingSchema = z.object({
  reason: z.string().min(1).max(1000).optional()
}).strict()

// ─── GET /api/super-admin/stats ───────────────────────────────
export async function getPlatformStatsHandler(req, res) {
  const stats = await getPlatformStats()
  return respond.success(res, stats)
}

// ─── GET /api/super-admin/audit-logs ─────────────────────────
export async function listAuditLogsHandler(req, res) {
  const page       = parseInt(req.query.page       ?? '1')
  const perPage    = parseInt(req.query.perPage    ?? '50')
  const entityType = req.query.entityType ?? undefined
  const actorRole  = req.query.actorRole  ?? undefined
  const agencyId   = req.query.agencyId   ?? undefined
  const entityId   = req.query.entityId   ?? undefined

  const result = await listAuditLogs({ page, perPage, entityType, actorRole, agencyId, entityId })
  return respond.paginated(res, result.data, result.meta)
}

// ─── GET /api/super-admin/audit-logs/:id ─────────────────────
export async function getAuditLogHandler(req, res) {
  const log = await getAuditLog(req.params.id)
  if (!log) return respond.notFound(res)
  return respond.success(res, log)
}

// ─── GET /api/super-admin/settings ───────────────────────────
export async function listPlatformSettingsHandler(req, res) {
  const settings = await listPlatformSettings()
  return respond.success(res, settings)
}

// ─── PATCH /api/super-admin/settings/:key ────────────────────
export async function updatePlatformSettingHandler(req, res) {
  const { value } = updateSettingSchema.parse(req.body)
  const result = await updatePlatformSetting(req.params.key, value, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND') return respond.notFound(res, result.message)
  return respond.success(res, result.setting, 'Setting updated.')
}

// ─── GET /api/super-admin/plan-configs ───────────────────────
export async function listPlanConfigsHandler(req, res) {
  const configs = await listPlanConfigs()
  return respond.success(res, configs)
}

// ─── PATCH /api/super-admin/plan-configs/:plan ────────────────
export async function updatePlanConfigHandler(req, res) {
  const data   = updatePlanConfigSchema.parse(req.body)
  const result = await updatePlanConfig(req.params.plan, data, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND') return respond.notFound(res, result.message)
  return respond.success(res, result.config, 'Plan config updated.')
}

// ─── GET /api/super-admin/sessions ───────────────────────────
export async function listActiveSessionsHandler(req, res) {
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '50')

  const result = await listActiveSessions({ page, perPage })
  return respond.paginated(res, result.data, result.meta)
}

// ─── DELETE /api/super-admin/sessions/:id ────────────────────
export async function forceLogoutHandler(req, res) {
  const result = await forceLogout(req.params.id, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND')     return respond.notFound(res, result.message)
  if (result.error === 'ALREADY_ENDED') return respond.error(res, result.message, 409, 'ALREADY_ENDED')
  return respond.success(res, null, 'Session terminated.')
}

// ─── GET /api/super-admin/flagged-ratings ────────────────────
export async function listFlaggedRatingsHandler(req, res) {
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '20')

  const result = await listFlaggedRatings({ page, perPage })
  return respond.paginated(res, result.data, result.meta)
}

// ─── DELETE /api/super-admin/flagged-ratings/:id ─────────────
export async function removeFlaggedRatingHandler(req, res) {
  const { reason } = removeRatingSchema.parse(req.body ?? {})
  const result = await removeFlaggedRating(req.params.id, {
    reason,
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND')    return respond.notFound(res, result.message)
  if (result.error === 'NOT_FLAGGED')  return respond.error(res, result.message, 409, 'NOT_FLAGGED')
  if (result.error === 'ALREADY_REMOVED') return respond.error(res, result.message, 409, 'ALREADY_REMOVED')
  return respond.success(res, null, 'Rating removed.')
}

// ─── POST /api/super-admin/agencies ──────────────────────────

const createAgencySchema = z.object({
  name:             z.string().min(1).max(200),
  ownerName:        z.string().min(1).max(200),
  contactEmail:     z.string().email(),
  contactPhone:     z.string().min(1).max(30),
  address:          z.string().min(1).max(500),
  adminName:        z.string().min(1).max(200),
  adminEmail:       z.string().email(),
  adminPassword:    z.string().min(8),
  adminPhone:       z.string().max(30).optional(),
  plan:             z.enum(['BASIC', 'PRO', 'ENTERPRISE']).optional(),
  commissionPercent: z.number().min(0).max(100).optional(),
  paymentTermsDays:  z.number().int().min(1).max(365).optional(),
}).strict()

export async function createAgencyHandler(req, res) {
  const data = createAgencySchema.parse(req.body)
  const result = await createAgency(data, {
    actorId: req.user.id,
    actorRole: req.user.role,
    ipAddress: req.ip,
  })
  if (result.error === 'EMAIL_TAKEN') return respond.error(res, result.message, 409, 'EMAIL_TAKEN')
  return respond.created(res, result, 'Agency created.')
}
