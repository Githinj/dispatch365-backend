import { z } from 'zod'
import { respond } from '../utils/respond.js'
import {
  createLoad,
  assignLoad,
  updateLoad,
  startTrip,
  submitDelivery,
  acceptDelivery,
  rejectDelivery,
  cancelLoad,
  listLoads,
  getLoadById,
  getLoadPOD
} from '../services/load.service.js'

// ─── Validation Schemas ───────────────────────────────────────

const createSchema = z.object({
  loadNumber:      z.string().min(1).max(100),
  pickupLocation:  z.string().min(1).max(500),
  dropoffLocation: z.string().min(1).max(500),
  pickupDate:      z.string().datetime(),
  deliveryDate:    z.string().datetime(),
  loadRate:        z.number().positive(),
  fleetId:         z.string().optional(),
  driverId:        z.string().optional(),
  vehicleId:       z.string().optional(),
  notes:           z.string().max(2000).optional()
}).strict()

const assignSchema = z.object({
  fleetId:   z.string().min(1),
  driverId:  z.string().min(1),
  vehicleId: z.string().min(1)
}).strict()

const updateSchema = z.object({
  loadNumber:      z.string().min(1).max(100).optional(),
  pickupLocation:  z.string().min(1).max(500).optional(),
  dropoffLocation: z.string().min(1).max(500).optional(),
  pickupDate:      z.string().datetime().optional(),
  deliveryDate:    z.string().datetime().optional(),
  loadRate:        z.number().positive().optional(),
  notes:           z.string().max(2000).optional()
}).strict()

const rejectSchema = z.object({
  reason: z.string().min(1).max(1000)
}).strict()

const cancelSchema = z.object({
  reason: z.string().max(1000).optional()
}).strict()

// ─── Helper — map validation errors to respond ────────────────
const VALIDATION_ERRORS = new Set([
  'INVALID_FLEET', 'INVALID_DRIVER', 'DRIVER_ON_LOAD',
  'INVALID_VEHICLE', 'VEHICLE_IN_MAINTENANCE', 'VEHICLE_ON_LOAD',
  'VEHICLE_INACTIVE', 'DRIVER_FLEET_MISMATCH', 'VEHICLE_FLEET_MISMATCH',
  'NO_RELATIONSHIP'
])

function handleServiceError(res, result) {
  if (result.error === 'NOT_FOUND')          return respond.notFound(res, result.message)
  if (result.error === 'FORBIDDEN')          return respond.forbidden(res, result.message)
  if (result.error === 'INVALID_STATUS')     return respond.error(res, result.message, 409, 'INVALID_STATUS')
  if (result.error === 'ALREADY_COMPLETED')  return respond.error(res, result.message, 409, 'ALREADY_COMPLETED')
  if (result.error === 'ALREADY_CANCELLED')  return respond.error(res, result.message, 409, 'ALREADY_CANCELLED')
  if (result.error === 'NO_POD')             return respond.error(res, result.message, 404, 'NO_POD')
  if (VALIDATION_ERRORS.has(result.error))   return respond.error(res, result.message, 422, result.error)
  // Fallthrough — unexpected error code
  return respond.error(res, result.message ?? 'An unexpected error occurred.', 500, result.error)
}

// ─── POST /api/loads ──────────────────────────────────────────
export async function createLoadHandler(req, res) {
  const data   = createSchema.parse(req.body)
  const result = await createLoad(data, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId
  })

  if (result.error) return handleServiceError(res, result)

  return respond.created(res, result.load, 'Load created successfully.')
}

// ─── POST /api/loads/:id/assign ───────────────────────────────
export async function assignLoadHandler(req, res) {
  const { fleetId, driverId, vehicleId } = assignSchema.parse(req.body)

  const result = await assignLoad(req.params.id, {
    fleetId,
    driverId,
    vehicleId,
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId
  })

  if (result.error) return handleServiceError(res, result)

  return respond.success(res, result.load, 'Load assigned successfully.')
}

// ─── PATCH /api/loads/:id ─────────────────────────────────────
export async function updateLoadHandler(req, res) {
  const data   = updateSchema.parse(req.body)
  const result = await updateLoad(req.params.id, data, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId
  })

  if (result.error) return handleServiceError(res, result)

  return respond.success(res, result.load, 'Load updated.')
}

// ─── POST /api/loads/:id/start-trip ──────────────────────────
export async function startTripHandler(req, res) {
  const result = await startTrip(req.params.id, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error) return handleServiceError(res, result)

  return respond.success(res, null, 'Trip started. Load is now IN_TRANSIT.')
}

// ─── POST /api/loads/:id/submit-delivery ─────────────────────
// Multipart — POD file required (field name: "pod")
export async function submitDeliveryHandler(req, res) {
  const result = await submitDelivery(req.params.id, req.file ?? null, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip
  })

  if (result.error) return handleServiceError(res, result)

  return respond.success(res, null, 'Proof of delivery submitted. Awaiting dispatcher confirmation.')
}

// ─── POST /api/loads/:id/accept-delivery ─────────────────────
export async function acceptDeliveryHandler(req, res) {
  const result = await acceptDelivery(req.params.id, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId
  })

  if (result.error) return handleServiceError(res, result)

  return respond.success(res, null, 'Delivery accepted. Load is COMPLETED.')
}

// ─── POST /api/loads/:id/reject-delivery ─────────────────────
export async function rejectDeliveryHandler(req, res) {
  const { reason } = rejectSchema.parse(req.body)

  const result = await rejectDelivery(req.params.id, {
    reason,
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId
  })

  if (result.error) return handleServiceError(res, result)

  return respond.success(res, null, 'Delivery rejected. Driver must resubmit POD.')
}

// ─── POST /api/loads/:id/cancel ───────────────────────────────
export async function cancelLoadHandler(req, res) {
  const { reason } = cancelSchema.parse(req.body)

  const result = await cancelLoad(req.params.id, {
    reason,
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId
  })

  if (result.error) return handleServiceError(res, result)

  return respond.success(res, null, 'Load cancelled.')
}

// ─── GET /api/loads ───────────────────────────────────────────
export async function listLoadsHandler(req, res) {
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '20')
  const status  = req.query.status ?? undefined

  const result = await listLoads({ page, perPage, status, isolation: req.isolation })

  return respond.paginated(res, result.data, result.meta)
}

// ─── GET /api/loads/:id ───────────────────────────────────────
export async function getLoadHandler(req, res) {
  const load = await getLoadById(req.params.id, req.isolation)
  if (!load) return respond.notFound(res)
  return respond.success(res, load)
}

// ─── GET /api/loads/:id/pod ───────────────────────────────────
export async function getLoadPODHandler(req, res) {
  const result = await getLoadPOD(req.params.id, req.isolation)
  if (result.error) return handleServiceError(res, result)
  return respond.success(res, { signedUrl: result.signedUrl })
}
