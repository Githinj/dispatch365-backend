import { z } from 'zod'
import { respond } from '../utils/respond.js'
import {
  inviteFleet,
  validateRegistrationToken,
  registerFleet,
  approveFleet,
  rejectFleet,
  suspendFleet,
  reactivateFleet,
  listFleets,
  getFleetById,
  getFleetDocuments,
  uploadFleetDocument,
  updateFleet,
  updateFleetRelationship,
  resendInvite
} from '../services/fleet.service.js'

// ─── Validation Schemas ───────────────────────────────────────

const inviteSchema = z.object({
  fleetName: z.string().min(1).max(200),
  adminName: z.string().min(1).max(200),
  email:     z.string().email()
}).strict()

const registerSchema = z.object({
  name:          z.string().min(1).max(200),
  adminName:     z.string().min(1).max(200),
  phone:         z.string().min(1).max(30),
  address:       z.string().max(500).optional(),
  contactPerson: z.string().max(200).optional(),
  password:      z.string().min(8, 'Password must be at least 8 characters')
}).strict()

const approveSchema = z.object({
  commissionOverride: z.number().min(0).max(100).optional()
})

const rejectSchema = z.object({
  reason: z.string().min(1).max(500)
}).strict()

const suspendSchema = z.object({
  reason: z.string().min(1).max(500)
}).strict()

const updateFleetSchema = z.object({
  name:          z.string().min(1).max(200).optional(),
  adminName:     z.string().min(1).max(200).optional(),
  phone:         z.string().min(1).max(30).optional(),
  address:       z.string().max(500).optional(),
  contactPerson: z.string().max(200).optional()
}).strict()

const documentTypeSchema = z.object({
  documentType: z.enum(['businessCert', 'operatingLicense', 'insuranceCert', 'other'])
}).strict()

const relationshipSchema = z.object({
  commissionPercent: z.number().min(0).max(100)
}).strict()

// ─── POST /api/fleets/invite ──────────────────────────────────
export async function inviteFleetHandler(req, res) {
  const { fleetName, adminName, email } = inviteSchema.parse(req.body)

  const result = await inviteFleet({
    agencyId:   req.user.agencyId,
    fleetName,
    adminName,
    email,
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND')    return respond.notFound(res)
  if (result.error === 'EMAIL_IN_USE') return respond.error(res, result.message, 409, 'EMAIL_IN_USE')

  return respond.created(res, result.fleet, 'Fleet invitation sent successfully.')
}

// ─── GET /api/fleets/register/:token (public) ─────────────────
export async function validateTokenHandler(req, res) {
  const result = await validateRegistrationToken(req.params.token)

  if (result.error === 'INVALID_TOKEN') return respond.notFound(res, result.message)
  if (result.error === 'TOKEN_USED')    return respond.error(res, result.message, 409, 'TOKEN_USED')
  if (result.error === 'TOKEN_EXPIRED') return respond.error(res, result.message, 410, 'TOKEN_EXPIRED')

  return respond.success(res, result.fleet, 'Registration link is valid.')
}

// ─── POST /api/fleets/register/:token (public) ────────────────
export async function registerFleetHandler(req, res) {
  const data  = registerSchema.parse(req.body)
  const files = req.files ?? {} // from uploadFleetRegistrationDocs multer

  const result = await registerFleet(req.params.token, data, files)

  if (result.error === 'INVALID_TOKEN') return respond.notFound(res, result.message)
  if (result.error === 'TOKEN_USED')    return respond.error(res, result.message, 409, 'TOKEN_USED')
  if (result.error === 'TOKEN_EXPIRED') return respond.error(res, result.message, 410, 'TOKEN_EXPIRED')

  return respond.created(res, result.fleet, 'Fleet registration submitted. Awaiting approval.')
}

// ─── GET /api/fleets ──────────────────────────────────────────
export async function listFleetsHandler(req, res) {
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '20')
  const status  = req.query.status ?? undefined

  const result = await listFleets({ page, perPage, status, isolation: req.isolation })
  return respond.paginated(res, result.data, result.meta)
}

// ─── GET /api/fleets/:id ──────────────────────────────────────
export async function getFleetHandler(req, res) {
  const fleet = await getFleetById(req.params.id, req.isolation)
  if (!fleet) return respond.notFound(res)
  return respond.success(res, fleet)
}

// ─── PATCH /api/fleets/:id ────────────────────────────────────
export async function updateFleetHandler(req, res) {
  const { role, fleetId } = req.user

  // FLEET_ADMIN can only update their own fleet
  if (role === 'FLEET_ADMIN' && req.params.id !== fleetId) {
    return respond.notFound(res)
  }

  const data    = updateFleetSchema.parse(req.body)
  const updated = await updateFleet(req.params.id, data)

  if (!updated) return respond.notFound(res)
  return respond.success(res, updated, 'Fleet updated successfully.')
}

// ─── POST /api/fleets/:id/approve ────────────────────────────
export async function approveFleetHandler(req, res) {
  const { commissionOverride } = approveSchema.parse(req.body)

  const result = await approveFleet(req.params.id, {
    actorId:            req.user.id,
    actorRole:          req.user.role,
    actorEmail:         req.user.email,
    ipAddress:          req.ip,
    agencyId:           req.user.agencyId ?? null,
    commissionOverride: commissionOverride ?? null
  })

  if (result.error === 'NOT_FOUND')       return respond.notFound(res)
  if (result.error === 'INVALID_STATUS')  return respond.error(res, result.message, 409, 'INVALID_STATUS')
  if (result.error === 'NO_AGENCY')       return respond.error(res, result.message, 422, 'NO_AGENCY')

  return respond.success(res, null, 'Fleet approved successfully.')
}

// ─── POST /api/fleets/:id/reject ─────────────────────────────
export async function rejectFleetHandler(req, res) {
  const { reason } = rejectSchema.parse(req.body)

  const result = await rejectFleet(req.params.id, {
    reason,
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId ?? null
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Fleet rejected.')
}

// ─── POST /api/fleets/:id/suspend ────────────────────────────
export async function suspendFleetHandler(req, res) {
  const { reason } = suspendSchema.parse(req.body)

  const result = await suspendFleet(req.params.id, {
    reason,
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId ?? null
  })

  if (result.error === 'NOT_FOUND')        return respond.notFound(res)
  if (result.error === 'ALREADY_SUSPENDED') return respond.error(res, result.message, 409, 'ALREADY_SUSPENDED')
  if (result.error === 'INVALID_STATUS')   return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Fleet suspended.')
}

// ─── POST /api/fleets/:id/reactivate ─────────────────────────
export async function reactivateFleetHandler(req, res) {
  const result = await reactivateFleet(req.params.id, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId ?? null
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'ALREADY_ACTIVE') return respond.error(res, result.message, 409, 'ALREADY_ACTIVE')
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Fleet reactivated.')
}

// ─── GET /api/fleets/:id/documents ───────────────────────────
export async function getDocumentsHandler(req, res) {
  // Verify the fleet is accessible first
  const fleet = await getFleetById(req.params.id, req.isolation)
  if (!fleet) return respond.notFound(res)

  const docs = await getFleetDocuments(req.params.id)
  return respond.success(res, docs)
}

// ─── POST /api/fleets/:id/documents ──────────────────────────
export async function uploadDocumentHandler(req, res) {
  const { documentType } = documentTypeSchema.parse(req.body)

  if (!req.file) return respond.error(res, 'No file uploaded.', 400, 'NO_FILE')

  const doc = await uploadFleetDocument(req.params.id, req.file, documentType, {
    actorId:    req.user.id,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  return respond.created(res, doc, 'Document uploaded successfully.')
}

// ─── PATCH /api/fleets/:id/relationship ──────────────────────
export async function updateRelationshipHandler(req, res) {
  const { commissionPercent } = relationshipSchema.parse(req.body)

  const agencyId = req.user.role === 'SUPER_ADMIN'
    ? req.body.agencyId // SA must provide agencyId
    : req.user.agencyId

  if (!agencyId) return respond.error(res, 'agencyId is required.', 422, 'MISSING_AGENCY_ID')

  const rel = await updateFleetRelationship(agencyId, req.params.id, { commissionPercent })
  if (!rel) return respond.notFound(res, 'No active relationship found between this agency and fleet.')

  return respond.success(res, rel, 'Commission updated successfully.')
}

// ─── POST /api/fleets/:id/resend-invite ──────────────────────
export async function resendInviteHandler(req, res) {
  const result = await resendInvite(req.params.id, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId ?? null
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Invitation resent successfully.')
}
