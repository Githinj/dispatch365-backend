import { z } from 'zod'
import { respond } from '../utils/respond.js'
import {
  inviteDriver,
  resendDriverInvite,
  validateInviteToken,
  acceptInvite,
  listDrivers,
  getDriverById,
  updateDriverProfile,
  deactivateDriver,
  reactivateDriver,
  uploadDriverDocument,
  getDriverDocuments,
  initiateDriverTransfer,
  approveDriverTransfer,
  declineDriverTransfer,
  cancelDriverTransfer,
  listDriverTransfers,
  initiateDriverJoinRequest,
  approveDriverJoinRequest,
  declineDriverJoinRequest,
  cancelDriverJoinRequest,
  listDriverJoinRequests
} from '../services/driver.service.js'

// ─── Validation Schemas ───────────────────────────────────────

const inviteSchema = z.object({
  name:  z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().max(30).optional()
}).strict()

const acceptInviteSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters')
}).strict()

const updateProfileSchema = z.object({
  name:           z.string().min(1).max(200).optional(),
  phone:          z.string().max(30).optional(),
  licenseNumber:  z.string().max(100).optional(),
  licenseClass:   z.string().max(50).optional(),
  licenseExpiry:  z.string().datetime().optional()
}).strict()

const documentTypeSchema = z.object({
  documentType: z.enum(['license', 'photo', 'medical', 'hazmat', 'background', 'other']),
  isRequired:   z.boolean().optional()
}).strict()

const transferSchema = z.object({
  toFleetId: z.string().min(1)
}).strict()

const declineSchema = z.object({
  reason: z.string().min(1).max(500).optional()
})

const joinRequestSchema = z.object({
  toFleetId: z.string().min(1),
  reason:    z.string().max(1000).optional()
}).strict()

// ─── POST /api/drivers/invite ─────────────────────────────────
export async function inviteDriverHandler(req, res) {
  const { name, email, phone } = inviteSchema.parse(req.body)

  const result = await inviteDriver({
    fleetId:    req.user.fleetId,
    name, email, phone,
    actorId:    req.user.id,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND')    return respond.notFound(res)
  if (result.error === 'EMAIL_IN_USE') return respond.error(res, result.message, 409, 'EMAIL_IN_USE')

  const { password: _, inviteToken: __, inviteTokenExpiry: ___, ...safe } = result.driver
  return respond.created(res, safe, 'Driver invited successfully.')
}

// ─── POST /api/drivers/:id/resend-invite ──────────────────────
export async function resendInviteHandler(req, res) {
  const result = await resendDriverInvite(req.params.id, {
    actorId:    req.user.id,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Invite resent successfully.')
}

// ─── GET /api/drivers/accept-invite/:token (public) ──────────
export async function validateInviteHandler(req, res) {
  const result = await validateInviteToken(req.params.token)

  if (result.error === 'INVALID_TOKEN') return respond.notFound(res, result.message)
  if (result.error === 'TOKEN_USED')    return respond.error(res, result.message, 409, 'TOKEN_USED')
  if (result.error === 'TOKEN_EXPIRED') return respond.error(res, result.message, 410, 'TOKEN_EXPIRED')

  return respond.success(res, result.driver, 'Invite link is valid.')
}

// ─── POST /api/drivers/accept-invite/:token (public) ─────────
export async function acceptInviteHandler(req, res) {
  const { password } = acceptInviteSchema.parse(req.body)

  const result = await acceptInvite(req.params.token, { password })

  if (result.error === 'INVALID_TOKEN') return respond.notFound(res, result.message)
  if (result.error === 'TOKEN_USED')    return respond.error(res, result.message, 409, 'TOKEN_USED')
  if (result.error === 'TOKEN_EXPIRED') return respond.error(res, result.message, 410, 'TOKEN_EXPIRED')

  const { password: _, inviteToken: __, inviteTokenExpiry: ___, ...safe } = result.driver
  return respond.created(res, safe, 'Account activated. You can now log in.')
}

// ─── GET /api/drivers ─────────────────────────────────────────
export async function listDriversHandler(req, res) {
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '20')
  const status  = req.query.status ?? undefined

  const result = await listDrivers({ page, perPage, status, isolation: req.isolation })
  return respond.paginated(res, result.data, result.meta)
}

// ─── GET /api/drivers/:id ─────────────────────────────────────
export async function getDriverHandler(req, res) {
  const driver = await getDriverById(req.params.id, req.isolation)
  if (!driver) return respond.notFound(res)

  const { password: _, inviteToken: __, inviteTokenExpiry: ___, ...safe } = driver
  return respond.success(res, safe)
}

// ─── PATCH /api/drivers/:id ───────────────────────────────────
export async function updateDriverHandler(req, res) {
  const data    = updateProfileSchema.parse(req.body)
  const updated = await updateDriverProfile(req.params.id, data, req.isolation)

  if (!updated) return respond.notFound(res)

  const { password: _, inviteToken: __, inviteTokenExpiry: ___, ...safe } = updated
  return respond.success(res, safe, 'Profile updated successfully.')
}

// ─── POST /api/drivers/:id/deactivate ────────────────────────
export async function deactivateDriverHandler(req, res) {
  const result = await deactivateDriver(req.params.id, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND')        return respond.notFound(res)
  if (result.error === 'ALREADY_INACTIVE') return respond.error(res, result.message, 409, 'ALREADY_INACTIVE')
  if (result.error === 'ON_LOAD')          return respond.error(res, result.message, 409, 'ON_LOAD')
  if (result.error === 'HAS_ACTIVE_LOADS') return respond.error(res, result.message, 409, 'HAS_ACTIVE_LOADS')

  return respond.success(res, null, 'Driver deactivated.')
}

// ─── POST /api/drivers/:id/reactivate ────────────────────────
export async function reactivateDriverHandler(req, res) {
  const result = await reactivateDriver(req.params.id, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'ALREADY_ACTIVE') return respond.error(res, result.message, 409, 'ALREADY_ACTIVE')
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Driver reactivated.')
}

// ─── POST /api/drivers/:id/documents ─────────────────────────
export async function uploadDocumentHandler(req, res) {
  const { documentType, isRequired } = documentTypeSchema.parse(req.body)

  if (!req.file) return respond.error(res, 'No file uploaded.', 400, 'NO_FILE')

  // Fleet Admin can mark docs as required; Driver cannot
  const required = req.user.role === 'FLEET_ADMIN' ? (isRequired ?? false) : false

  const doc = await uploadDriverDocument(req.params.id, req.file, documentType, required, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  return respond.created(res, doc, 'Document uploaded successfully.')
}

// ─── GET /api/drivers/:id/documents ──────────────────────────
export async function getDocumentsHandler(req, res) {
  const docs = await getDriverDocuments(req.params.id, req.isolation)
  if (docs === null) return respond.notFound(res)
  return respond.success(res, docs)
}

// ──────────────────────────────────────────────────────────────
// TRANSFER FLOW
// ──────────────────────────────────────────────────────────────

// ─── POST /api/drivers/transfers ─────────────────────────────
export async function initiateTransferHandler(req, res) {
  const { toFleetId } = transferSchema.parse(req.body)

  const result = await initiateDriverTransfer(req.user.id, {
    toFleetId,
    actorId:    req.user.id,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND')        return respond.notFound(res)
  if (result.error === 'FORBIDDEN')        return respond.forbidden(res, result.message)
  if (result.error === 'INVALID_STATUS')   return respond.error(res, result.message, 409, 'INVALID_STATUS')
  if (result.error === 'INVALID_FLEET')    return respond.error(res, result.message, 422, 'INVALID_FLEET')
  if (result.error === 'SAME_FLEET')       return respond.error(res, result.message, 422, 'SAME_FLEET')
  if (result.error === 'HAS_ACTIVE_LOADS') return respond.error(res, result.message, 409, 'HAS_ACTIVE_LOADS')
  if (result.error === 'TRANSFER_PENDING') return respond.error(res, result.message, 409, 'TRANSFER_PENDING')

  return respond.created(res, result.transferRequest, 'Transfer request submitted.')
}

// ─── GET /api/drivers/transfers ──────────────────────────────
export async function listTransfersHandler(req, res) {
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '20')
  const status  = req.query.status ?? undefined

  const result = await listDriverTransfers({ page, perPage, status, isolation: req.isolation })
  return respond.paginated(res, result.data, result.meta)
}

// ─── POST /api/drivers/transfers/:requestId/approve ──────────
export async function approveTransferHandler(req, res) {
  const result = await approveDriverTransfer(req.params.requestId, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    fleetId:    req.user.fleetId ?? null
  })

  if (result.error === 'NOT_FOUND')                return respond.notFound(res)
  if (result.error === 'INVALID_STATUS')           return respond.error(res, result.message, 409, 'INVALID_STATUS')
  if (result.error === 'ALREADY_APPROVED_BY_FLEET') return respond.error(res, result.message, 409, 'ALREADY_APPROVED')

  const message = result.completed
    ? 'Transfer approved. Driver has been moved to new fleet.'
    : 'Approval recorded. Awaiting the other fleet.'

  return respond.success(res, { completed: result.completed }, message)
}

// ─── POST /api/drivers/transfers/:requestId/decline ──────────
export async function declineTransferHandler(req, res) {
  const { reason } = declineSchema.parse(req.body)

  const result = await declineDriverTransfer(req.params.requestId, {
    reason,
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    fleetId:    req.user.fleetId ?? null
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Transfer declined.')
}

// ─── POST /api/drivers/transfers/:requestId/cancel ───────────
export async function cancelTransferHandler(req, res) {
  const result = await cancelDriverTransfer(req.params.requestId, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'FORBIDDEN')      return respond.forbidden(res, result.message)
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Transfer cancelled.')
}

// ──────────────────────────────────────────────────────────────
// JOIN REQUEST FLOW
// ──────────────────────────────────────────────────────────────

// ─── POST /api/drivers/join-requests ─────────────────────────
export async function initiateJoinRequestHandler(req, res) {
  const { toFleetId, reason } = joinRequestSchema.parse(req.body)

  const result = await initiateDriverJoinRequest(req.user.id, {
    toFleetId, reason,
    actorId:    req.user.id,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND')       return respond.notFound(res)
  if (result.error === 'FORBIDDEN')       return respond.forbidden(res, result.message)
  if (result.error === 'INVALID_STATUS')  return respond.error(res, result.message, 409, 'INVALID_STATUS')
  if (result.error === 'INVALID_FLEET')   return respond.error(res, result.message, 422, 'INVALID_FLEET')
  if (result.error === 'SAME_FLEET')      return respond.error(res, result.message, 422, 'SAME_FLEET')
  if (result.error === 'REQUEST_PENDING') return respond.error(res, result.message, 409, 'REQUEST_PENDING')

  return respond.created(res, result.joinRequest, 'Join request submitted.')
}

// ─── GET /api/drivers/join-requests ──────────────────────────
export async function listJoinRequestsHandler(req, res) {
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '20')
  const status  = req.query.status ?? undefined

  const result = await listDriverJoinRequests({ page, perPage, status, isolation: req.isolation })
  return respond.paginated(res, result.data, result.meta)
}

// ─── POST /api/drivers/join-requests/:requestId/approve ──────
export async function approveJoinRequestHandler(req, res) {
  const result = await approveDriverJoinRequest(req.params.requestId, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    fleetId:    req.user.fleetId ?? null
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Join request approved. Driver is now active.')
}

// ─── POST /api/drivers/join-requests/:requestId/decline ──────
export async function declineJoinRequestHandler(req, res) {
  const { reason } = declineSchema.parse(req.body)

  const result = await declineDriverJoinRequest(req.params.requestId, {
    reason,
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    fleetId:    req.user.fleetId ?? null
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Join request declined.')
}

// ─── POST /api/drivers/join-requests/:requestId/cancel ───────
export async function cancelJoinRequestHandler(req, res) {
  const result = await cancelDriverJoinRequest(req.params.requestId, { actorId: req.user.id })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'FORBIDDEN')      return respond.forbidden(res, result.message)
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Join request cancelled.')
}
