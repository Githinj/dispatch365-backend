import { z } from 'zod'
import { respond } from '../utils/respond.js'
import {
  createVehicle,
  listVehicles,
  getVehicleById,
  updateVehicle,
  deactivateVehicle,
  reactivateVehicle,
  startMaintenance,
  completeMaintenance,
  listMaintenanceRecords
} from '../services/vehicle.service.js'

// ─── Validation Schemas ───────────────────────────────────────

const createSchema = z.object({
  make:             z.string().min(1).max(100),
  model:            z.string().min(1).max(100),
  year:             z.number().int().min(1990).max(new Date().getFullYear() + 1),
  plateNumber:      z.string().min(1).max(20),
  vinNumber:        z.string().max(17).optional(),
  vehicleType:      z.enum(['SEMI', 'FLATBED', 'REEFER', 'BOX_TRUCK', 'TANKER', 'OTHER']),
  capacityTons:     z.number().positive().optional(),
  insuranceExpiry:  z.string().datetime().optional(),
  inspectionExpiry: z.string().datetime().optional()
}).strict()

const updateSchema = z.object({
  make:             z.string().min(1).max(100).optional(),
  model:            z.string().min(1).max(100).optional(),
  year:             z.number().int().min(1990).max(new Date().getFullYear() + 1).optional(),
  plateNumber:      z.string().min(1).max(20).optional(),
  vinNumber:        z.string().max(17).optional(),
  vehicleType:      z.enum(['SEMI', 'FLATBED', 'REEFER', 'BOX_TRUCK', 'TANKER', 'OTHER']).optional(),
  capacityTons:     z.number().positive().optional(),
  insuranceExpiry:  z.string().datetime().optional(),
  inspectionExpiry: z.string().datetime().optional()
}).strict()

const maintenanceStartSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
  notes:  z.string().max(2000).optional()
})

const maintenanceCompleteSchema = z.object({
  notes: z.string().max(2000).optional()
})

// ─── POST /api/vehicles ───────────────────────────────────────
export async function createVehicleHandler(req, res) {
  const data = createSchema.parse(req.body)

  const result = await createVehicle(data, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    fleetId:    req.user.fleetId
  })

  if (result.error === 'NOT_FOUND') return respond.notFound(res)

  return respond.created(res, result.vehicle, 'Vehicle added successfully.')
}

// ─── GET /api/vehicles ────────────────────────────────────────
export async function listVehiclesHandler(req, res) {
  const page        = parseInt(req.query.page        ?? '1')
  const perPage     = parseInt(req.query.perPage     ?? '20')
  const status      = req.query.status      ?? undefined
  const vehicleType = req.query.vehicleType ?? undefined
  const fleetId     = req.query.fleetId     ?? undefined

  const result = await listVehicles({ page, perPage, status, vehicleType, fleetId, isolation: req.isolation })

  if (result.error === 'FLEET_ID_REQUIRED') return respond.error(res, result.message, 422, 'FLEET_ID_REQUIRED')
  if (result.error === 'NOT_FOUND')         return respond.notFound(res, result.message)

  return respond.paginated(res, result.data, result.meta)
}

// ─── GET /api/vehicles/:id ────────────────────────────────────
export async function getVehicleHandler(req, res) {
  const vehicle = await getVehicleById(req.params.id, req.isolation)
  if (!vehicle) return respond.notFound(res)
  return respond.success(res, vehicle)
}

// ─── PATCH /api/vehicles/:id ──────────────────────────────────
export async function updateVehicleHandler(req, res) {
  const data   = updateSchema.parse(req.body)
  const result = await updateVehicle(req.params.id, data, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    fleetId:    req.user.fleetId ?? null
  })

  if (result.error === 'NOT_FOUND') return respond.notFound(res)
  if (result.error === 'INACTIVE')  return respond.error(res, result.message, 409, 'VEHICLE_INACTIVE')

  return respond.success(res, result.vehicle, 'Vehicle updated.')
}

// ─── POST /api/vehicles/:id/deactivate ───────────────────────
export async function deactivateVehicleHandler(req, res) {
  const result = await deactivateVehicle(req.params.id, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    fleetId:    req.user.fleetId ?? null
  })

  if (result.error === 'NOT_FOUND')        return respond.notFound(res)
  if (result.error === 'ALREADY_INACTIVE') return respond.error(res, result.message, 409, 'ALREADY_INACTIVE')
  if (result.error === 'HAS_ACTIVE_LOADS') return respond.error(res, result.message, 409, 'HAS_ACTIVE_LOADS')

  return respond.success(res, null, 'Vehicle deactivated.')
}

// ─── POST /api/vehicles/:id/reactivate ───────────────────────
export async function reactivateVehicleHandler(req, res) {
  const result = await reactivateVehicle(req.params.id, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    fleetId:    req.user.fleetId ?? null
  })

  if (result.error === 'NOT_FOUND')    return respond.notFound(res)
  if (result.error === 'NOT_INACTIVE') return respond.error(res, result.message, 409, 'NOT_INACTIVE')

  return respond.success(res, null, 'Vehicle reactivated.')
}

// ─── POST /api/vehicles/:id/maintenance/start ─────────────────
export async function startMaintenanceHandler(req, res) {
  const { reason, notes } = maintenanceStartSchema.parse(req.body)

  const result = await startMaintenance(req.params.id, {
    reason, notes,
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    fleetId:    req.user.fleetId ?? null
  })

  if (result.error === 'NOT_FOUND')             return respond.notFound(res)
  if (result.error === 'ALREADY_IN_MAINTENANCE') return respond.error(res, result.message, 409, 'ALREADY_IN_MAINTENANCE')
  if (result.error === 'INACTIVE')              return respond.error(res, result.message, 409, 'VEHICLE_INACTIVE')
  if (result.error === 'ON_LOAD')               return respond.error(res, result.message, 409, 'ON_LOAD')

  return respond.created(res, result.record, 'Maintenance started.')
}

// ─── POST /api/vehicles/:id/maintenance/complete ──────────────
export async function completeMaintenanceHandler(req, res) {
  const { notes } = maintenanceCompleteSchema.parse(req.body)

  const result = await completeMaintenance(req.params.id, {
    notes,
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    fleetId:    req.user.fleetId ?? null
  })

  if (result.error === 'NOT_FOUND')         return respond.notFound(res)
  if (result.error === 'NOT_IN_MAINTENANCE') return respond.error(res, result.message, 409, 'NOT_IN_MAINTENANCE')
  if (result.error === 'NO_OPEN_RECORD')    return respond.error(res, result.message, 409, 'NO_OPEN_RECORD')

  return respond.success(res, result.record, 'Maintenance completed. Vehicle is now available.')
}

// ─── GET /api/vehicles/:id/maintenance ───────────────────────
export async function listMaintenanceHandler(req, res) {
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '20')

  const result = await listMaintenanceRecords(req.params.id, { page, perPage, isolation: req.isolation })
  if (result === null) return respond.notFound(res)

  return respond.paginated(res, result.data, result.meta)
}
