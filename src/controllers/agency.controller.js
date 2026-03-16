import { z } from 'zod'
import { respond } from '../utils/respond.js'
import {
  getAllAgencies,
  getAgencyById,
  updateAgency,
  updateAgencyBranding,
  suspendAgency,
  reactivateAgency
} from '../services/agency.service.js'

// ─── Validation Schemas ──────────────────────────────────────

const updateAgencySchema = z.object({
  name:                z.string().min(1).optional(),
  ownerName:           z.string().min(1).optional(),
  contactEmail:        z.string().email().optional(),
  contactPhone:        z.string().min(1).optional(),
  address:             z.string().min(1).optional(),
  paymentTermsDays:    z.number().int().min(1).max(365).optional(),
  commissionPercent:   z.number().min(0).max(100).optional(),
  // Super Admin only — stripped in service if not SA
  plan:                z.enum(['BASIC', 'PRO', 'ENTERPRISE']).optional(),
  subscriptionExpiresAt: z.string().datetime().optional()
}).strict()

const brandingSchema = z.object({
  primaryColor:      z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a hex color').optional(),
  secondaryColor:    z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a hex color').optional(),
  agencyAddress:     z.string().optional(),
  agencyPhone:       z.string().optional(),
  agencyEmail:       z.string().email().optional(),
  footerText:        z.string().max(500).optional(),
  customEmailDomain: z.string().optional()
})

const suspendSchema = z.object({
  reason: z.string().min(1).max(500)
})

// ─── GET /api/agencies ───────────────────────────────────────
export async function listAgencies(req, res) {
  const { role, agencyId } = req.user

  // Agency Admin sees only their own agency
  if (role === 'AGENCY_ADMIN') {
    const agency = await getAgencyById(agencyId)
    if (!agency) return respond.notFound(res)
    return respond.success(res, agency)
  }

  // Super Admin sees all with pagination + optional status filter
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '20')
  const status  = req.query.status ?? undefined

  const result = await getAllAgencies({ page, perPage, status })
  return respond.paginated(res, result.data, result.meta)
}

// ─── GET /api/agencies/:id ───────────────────────────────────
export async function getAgency(req, res) {
  const { role, agencyId } = req.user
  const { id } = req.params

  // Agency Admin can only view their own agency
  if (role === 'AGENCY_ADMIN' && id !== agencyId) {
    return respond.notFound(res)
  }

  const agency = await getAgencyById(id)
  if (!agency) return respond.notFound(res)

  return respond.success(res, agency)
}

// ─── PATCH /api/agencies/:id ─────────────────────────────────
export async function updateAgencyHandler(req, res) {
  const { role, agencyId } = req.user
  const { id } = req.params

  // Agency Admin can only update their own agency
  if (role === 'AGENCY_ADMIN' && id !== agencyId) {
    return respond.notFound(res)
  }

  const data = updateAgencySchema.parse(req.body)
  const result = await updateAgency(id, data, role)

  if (!result) return respond.notFound(res)

  return respond.success(res, result.updated, 'Agency updated successfully.')
}

// ─── PATCH /api/agencies/:id/branding ───────────────────────
export async function updateBrandingHandler(req, res) {
  const { role, agencyId } = req.user
  const { id } = req.params

  if (role === 'AGENCY_ADMIN' && id !== agencyId) {
    return respond.notFound(res)
  }

  const brandingData = brandingSchema.parse(req.body)
  const logoFile = req.file ?? null // from uploadLogo multer middleware

  const updated = await updateAgencyBranding(id, brandingData, logoFile)
  return respond.success(res, updated, 'Branding updated successfully.')
}

// ─── POST /api/agencies/:id/suspend ─────────────────────────
export async function suspendAgencyHandler(req, res) {
  const { reason } = suspendSchema.parse(req.body)
  const { id } = req.params

  const result = await suspendAgency(id, {
    reason,
    actorId:    req.user.id,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (!result) return respond.notFound(res)
  if (result.alreadySuspended) {
    return respond.error(res, 'Agency is already suspended.', 409, 'ALREADY_SUSPENDED')
  }

  return respond.success(
    res,
    { sessionsInvalidated: result.sessionsInvalidated },
    `Agency suspended. ${result.sessionsInvalidated} active sessions invalidated.`
  )
}

// ─── POST /api/agencies/:id/reactivate ──────────────────────
export async function reactivateAgencyHandler(req, res) {
  const { id } = req.params

  const result = await reactivateAgency(id, {
    actorId:    req.user.id,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (!result) return respond.notFound(res)
  if (result.alreadyActive) {
    return respond.error(res, 'Agency is already active.', 409, 'ALREADY_ACTIVE')
  }

  return respond.success(res, result, 'Agency reactivated successfully.')
}
