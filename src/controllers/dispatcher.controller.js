import { z } from 'zod'
import { respond } from '../utils/respond.js'
import {
  createDispatcher,
  listDispatchers,
  getDispatcherById,
  updateDispatcherProfile,
  deactivateDispatcher,
  reactivateDispatcher,
  initiateTransfer,
  approveTransfer,
  declineTransfer,
  cancelTransfer,
  listTransferRequests,
  initiateJoinRequest,
  approveJoinRequest,
  declineJoinRequest,
  cancelJoinRequest,
  listJoinRequests,
  createRating,
  getDispatcherRatings,
  respondToRating,
  flagRating,
  removeRating
} from '../services/dispatcher.service.js'

// ─── Validation Schemas ───────────────────────────────────────

const createSchema = z.object({
  name:     z.string().min(1).max(200),
  email:    z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone:    z.string().max(30).optional()
}).strict()

const updateProfileSchema = z.object({
  name:  z.string().min(1).max(200).optional(),
  phone: z.string().max(30).optional()
}).strict()

const transferInitiateSchema = z.object({
  toAgencyId: z.string().min(1)
}).strict()

const declineSchema = z.object({
  reason: z.string().min(1).max(500).optional()
})

const joinRequestSchema = z.object({
  toAgencyId: z.string().min(1),
  reason:     z.string().max(1000).optional()
}).strict()

const declineJoinSchema = z.object({
  reason: z.string().min(1).max(500).optional()
})

const ratingSchema = z.object({
  overallRating:         z.number().min(1).max(5),
  communicationRating:   z.number().min(1).max(5),
  professionalismRating: z.number().min(1).max(5),
  loadAccuracyRating:    z.number().min(1).max(5),
  reliabilityRating:     z.number().min(1).max(5),
  responsivenessRating:  z.number().min(1).max(5),
  writtenReview:         z.string().max(2000).optional()
}).strict()

const respondSchema = z.object({
  response: z.string().min(1).max(2000)
}).strict()

const flagSchema = z.object({
  reason: z.string().min(1).max(500)
}).strict()

const removeRatingSchema = z.object({
  reason: z.string().min(1).max(500).optional()
})

const suspendSchema = z.object({
  reason: z.string().min(1).max(500).optional()
})

// ─── POST /api/dispatchers ────────────────────────────────────
export async function createDispatcherHandler(req, res) {
  const { name, email, password, phone } = createSchema.parse(req.body)

  const result = await createDispatcher({
    agencyId:   req.user.agencyId,
    name, email, password, phone,
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'LIMIT_REACHED') return respond.error(res, result.message, 403,  'PLAN_LIMIT_REACHED')
  if (result.error === 'NOT_FOUND')     return respond.notFound(res)
  if (result.error === 'EMAIL_IN_USE')  return respond.error(res, result.message, 409, 'EMAIL_IN_USE')

  // Strip password from response
  const { password: _, ...safe } = result.dispatcher
  return respond.created(res, safe, 'Dispatcher created successfully.')
}

// ─── GET /api/dispatchers ─────────────────────────────────────
export async function listDispatchersHandler(req, res) {
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '20')
  const status  = req.query.status ?? undefined

  const result = await listDispatchers({ page, perPage, status, isolation: req.isolation })
  return respond.paginated(res, result.data, result.meta)
}

// ─── GET /api/dispatchers/:id ─────────────────────────────────
export async function getDispatcherHandler(req, res) {
  const dispatcher = await getDispatcherById(req.params.id, req.isolation)
  if (!dispatcher) return respond.notFound(res)

  // Strip password
  const { password: _, ...safe } = dispatcher
  return respond.success(res, safe)
}

// ─── PATCH /api/dispatchers/:id ───────────────────────────────
export async function updateProfileHandler(req, res) {
  const data    = updateProfileSchema.parse(req.body)
  const updated = await updateDispatcherProfile(req.params.id, data, req.isolation)

  if (!updated) return respond.notFound(res)

  const { password: _, ...safe } = updated
  return respond.success(res, safe, 'Profile updated successfully.')
}

// ─── POST /api/dispatchers/:id/deactivate ────────────────────
export async function deactivateHandler(req, res) {
  const result = await deactivateDispatcher(req.params.id, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId ?? null
  })

  if (result.error === 'NOT_FOUND')        return respond.notFound(res)
  if (result.error === 'ALREADY_INACTIVE') return respond.error(res, result.message, 409, 'ALREADY_INACTIVE')
  if (result.error === 'HAS_ACTIVE_LOADS') return respond.error(res, result.message, 409, 'HAS_ACTIVE_LOADS')

  return respond.success(res, null, 'Dispatcher deactivated.')
}

// ─── POST /api/dispatchers/:id/reactivate ────────────────────
export async function reactivateHandler(req, res) {
  const result = await reactivateDispatcher(req.params.id, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId ?? null
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'ALREADY_ACTIVE') return respond.error(res, result.message, 409, 'ALREADY_ACTIVE')
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')
  if (result.error === 'LIMIT_REACHED')  return respond.error(res, result.message, 403, 'PLAN_LIMIT_REACHED')

  return respond.success(res, null, 'Dispatcher reactivated.')
}

// ──────────────────────────────────────────────────────────────
// TRANSFER FLOW
// ──────────────────────────────────────────────────────────────

// ─── POST /api/dispatchers/transfers ─────────────────────────
export async function initiateTransferHandler(req, res) {
  const { toAgencyId } = transferInitiateSchema.parse(req.body)

  const result = await initiateTransfer(req.user.id, {
    toAgencyId,
    actorId:    req.user.id,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND')        return respond.notFound(res)
  if (result.error === 'FORBIDDEN')        return respond.forbidden(res, result.message)
  if (result.error === 'INVALID_STATUS')   return respond.error(res, result.message, 409, 'INVALID_STATUS')
  if (result.error === 'INVALID_AGENCY')   return respond.error(res, result.message, 422, 'INVALID_AGENCY')
  if (result.error === 'SAME_AGENCY')      return respond.error(res, result.message, 422, 'SAME_AGENCY')
  if (result.error === 'HAS_ACTIVE_LOADS') return respond.error(res, result.message, 409, 'HAS_ACTIVE_LOADS')
  if (result.error === 'TRANSFER_PENDING') return respond.error(res, result.message, 409, 'TRANSFER_PENDING')

  return respond.created(res, result.transferRequest, 'Transfer request submitted.')
}

// ─── GET /api/dispatchers/transfers ──────────────────────────
export async function listTransfersHandler(req, res) {
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '20')
  const status  = req.query.status ?? undefined

  const result = await listTransferRequests({ page, perPage, status, isolation: req.isolation })
  return respond.paginated(res, result.data, result.meta)
}

// ─── POST /api/dispatchers/transfers/:requestId/approve ──────
export async function approveTransferHandler(req, res) {
  const result = await approveTransfer(req.params.requestId, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId ?? null
  })

  if (result.error === 'NOT_FOUND')                  return respond.notFound(res)
  if (result.error === 'INVALID_STATUS')             return respond.error(res, result.message, 409, 'INVALID_STATUS')
  if (result.error === 'ALREADY_APPROVED_BY_AGENCY') return respond.error(res, result.message, 409, 'ALREADY_APPROVED')

  const message = result.completed
    ? 'Transfer approved. Dispatcher has been moved to new agency.'
    : 'Approval recorded. Awaiting the other agency.'

  return respond.success(res, { completed: result.completed }, message)
}

// ─── POST /api/dispatchers/transfers/:requestId/decline ──────
export async function declineTransferHandler(req, res) {
  const { reason } = declineSchema.parse(req.body)

  const result = await declineTransfer(req.params.requestId, {
    reason,
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId ?? null
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Transfer request declined.')
}

// ─── POST /api/dispatchers/transfers/:requestId/cancel ───────
export async function cancelTransferHandler(req, res) {
  const result = await cancelTransfer(req.params.requestId, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'FORBIDDEN')      return respond.forbidden(res, result.message)
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Transfer request cancelled.')
}

// ──────────────────────────────────────────────────────────────
// JOIN REQUEST FLOW
// ──────────────────────────────────────────────────────────────

// ─── POST /api/dispatchers/join-requests ─────────────────────
export async function initiateJoinRequestHandler(req, res) {
  const { toAgencyId, reason } = joinRequestSchema.parse(req.body)

  const result = await initiateJoinRequest(req.user.id, {
    toAgencyId, reason,
    actorId:    req.user.id,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND')       return respond.notFound(res)
  if (result.error === 'FORBIDDEN')       return respond.forbidden(res, result.message)
  if (result.error === 'INVALID_STATUS')  return respond.error(res, result.message, 409, 'INVALID_STATUS')
  if (result.error === 'INVALID_AGENCY')  return respond.error(res, result.message, 422, 'INVALID_AGENCY')
  if (result.error === 'SAME_AGENCY')     return respond.error(res, result.message, 422, 'SAME_AGENCY')
  if (result.error === 'REQUEST_PENDING') return respond.error(res, result.message, 409, 'REQUEST_PENDING')

  return respond.created(res, result.joinRequest, 'Join request submitted.')
}

// ─── GET /api/dispatchers/join-requests ──────────────────────
export async function listJoinRequestsHandler(req, res) {
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '20')
  const status  = req.query.status ?? undefined

  const result = await listJoinRequests({ page, perPage, status, isolation: req.isolation })
  return respond.paginated(res, result.data, result.meta)
}

// ─── POST /api/dispatchers/join-requests/:requestId/approve ──
export async function approveJoinRequestHandler(req, res) {
  const result = await approveJoinRequest(req.params.requestId, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId ?? null
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')
  if (result.error === 'LIMIT_REACHED')  return respond.error(res, result.message, 403, 'PLAN_LIMIT_REACHED')

  return respond.success(res, null, 'Join request approved. Dispatcher is now active.')
}

// ─── POST /api/dispatchers/join-requests/:requestId/decline ──
export async function declineJoinRequestHandler(req, res) {
  const { reason } = declineJoinSchema.parse(req.body)

  const result = await declineJoinRequest(req.params.requestId, {
    reason,
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId ?? null
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Join request declined.')
}

// ─── POST /api/dispatchers/join-requests/:requestId/cancel ───
export async function cancelJoinRequestHandler(req, res) {
  const result = await cancelJoinRequest(req.params.requestId, { actorId: req.user.id })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'FORBIDDEN')      return respond.forbidden(res, result.message)
  if (result.error === 'INVALID_STATUS') return respond.error(res, result.message, 409, 'INVALID_STATUS')

  return respond.success(res, null, 'Join request cancelled.')
}

// ──────────────────────────────────────────────────────────────
// RATINGS
// ──────────────────────────────────────────────────────────────

// ─── POST /api/dispatchers/:id/ratings ───────────────────────
export async function createRatingHandler(req, res) {
  const ratingData = ratingSchema.parse(req.body)

  const result = await createRating(req.params.id, ratingData, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId ?? null
  })

  if (result.error === 'NOT_FOUND') return respond.notFound(res)

  return respond.created(res, result.rating, 'Rating submitted.')
}

// ─── GET /api/dispatchers/:id/ratings ────────────────────────
export async function getRatingsHandler(req, res) {
  const ratings = await getDispatcherRatings(req.params.id, req.isolation)
  if (ratings === null) return respond.notFound(res)
  return respond.success(res, ratings)
}

// ─── POST /api/dispatchers/ratings/:ratingId/respond ─────────
export async function respondToRatingHandler(req, res) {
  const { response } = respondSchema.parse(req.body)

  const result = await respondToRating(req.params.ratingId, { response, actorId: req.user.id })

  if (result.error === 'NOT_FOUND')         return respond.notFound(res)
  if (result.error === 'FORBIDDEN')         return respond.forbidden(res, result.message)
  if (result.error === 'RATING_REMOVED')    return respond.error(res, result.message, 410, 'RATING_REMOVED')
  if (result.error === 'ALREADY_RESPONDED') return respond.error(res, result.message, 409, 'ALREADY_RESPONDED')

  return respond.success(res, null, 'Response submitted.')
}

// ─── POST /api/dispatchers/ratings/:ratingId/flag ────────────
export async function flagRatingHandler(req, res) {
  const { reason } = flagSchema.parse(req.body)

  const result = await flagRating(req.params.ratingId, { reason, actorId: req.user.id })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'FORBIDDEN')      return respond.forbidden(res, result.message)
  if (result.error === 'ALREADY_FLAGGED') return respond.error(res, result.message, 409, 'ALREADY_FLAGGED')
  if (result.error === 'RATING_REMOVED') return respond.error(res, result.message, 410, 'RATING_REMOVED')

  return respond.success(res, null, 'Rating flagged for review.')
}

// ─── DELETE /api/dispatchers/ratings/:ratingId ───────────────
export async function removeRatingHandler(req, res) {
  const { reason } = removeRatingSchema.parse(req.body)

  const result = await removeRating(req.params.ratingId, {
    reason,
    actorId:    req.user.id,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error === 'NOT_FOUND')      return respond.notFound(res)
  if (result.error === 'ALREADY_REMOVED') return respond.error(res, result.message, 409, 'ALREADY_REMOVED')

  return respond.success(res, null, 'Rating removed.')
}
