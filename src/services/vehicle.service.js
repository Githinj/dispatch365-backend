import { prisma } from './prisma.service.js'
import { writeAuditLog } from '../middleware/audit.middleware.js'

// Statuses that mean a vehicle is actively on a job
const ACTIVE_LOAD_STATUSES = ['ASSIGNED', 'IN_TRANSIT', 'PENDING_DELIVERY_CONFIRMATION']

// ─── Create Vehicle ────────────────────────────────────────────
export async function createVehicle(data, { actorId, actorRole, actorEmail, ipAddress, fleetId }) {
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId } })
  if (!fleet) return { error: 'NOT_FOUND', message: 'Fleet not found.' }

  const vehicle = await prisma.vehicle.create({
    data: { ...data, fleetId, status: 'AVAILABLE' }
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'CREATE',
    description: `Vehicle "${data.make} ${data.model}" (${data.plateNumber}) added to fleet "${fleet.name}".`,
    entityType:  'Vehicle',
    entityId:    vehicle.id,
    newValue:    data,
    ipAddress
  })

  return { vehicle }
}

// ─── List Vehicles ─────────────────────────────────────────────
export async function listVehicles({ page = 1, perPage = 20, status, vehicleType, fleetId: fleetIdFilter, isolation } = {}) {
  const skip  = (page - 1) * perPage
  const where = {}

  if (status)      where.status      = status
  if (vehicleType) where.vehicleType = vehicleType

  if (isolation.role === 'FLEET_ADMIN') {
    // Always scoped to their own fleet
    where.fleetId = isolation.fleetId
  } else if (isolation.role === 'AGENCY_ADMIN' || isolation.role === 'DISPATCHER') {
    // Must pass fleetId — service verifies the fleet belongs to their agency
    if (!fleetIdFilter) return { error: 'FLEET_ID_REQUIRED', message: 'fleetId query parameter is required.' }
    // Verify fleet has an active relationship with this agency
    const rel = await prisma.agencyFleetRelationship.findFirst({
      where: { agencyId: isolation.agencyId, fleetId: fleetIdFilter, status: 'ACTIVE' }
    })
    if (!rel) return { error: 'NOT_FOUND', message: 'Fleet not found or not associated with your agency.' }
    where.fleetId = fleetIdFilter
  } else if (isolation.role === 'SUPER_ADMIN') {
    if (fleetIdFilter) where.fleetId = fleetIdFilter
  }

  const [vehicles, total] = await Promise.all([
    prisma.vehicle.findMany({
      where,
      skip,
      take:    perPage,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { loads: true, maintenanceRecords: true } } }
    }),
    prisma.vehicle.count({ where })
  ])

  return { data: vehicles, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } }
}

// ─── Get Vehicle By ID ─────────────────────────────────────────
export async function getVehicleById(vehicleId, isolation) {
  const where = { id: vehicleId }

  if (isolation.role === 'FLEET_ADMIN') {
    where.fleetId = isolation.fleetId
  } else if (isolation.role === 'AGENCY_ADMIN' || isolation.role === 'DISPATCHER') {
    // Verify fleet is in their agency
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle) return null
    const rel = await prisma.agencyFleetRelationship.findFirst({
      where: { agencyId: isolation.agencyId, fleetId: vehicle.fleetId, status: 'ACTIVE' }
    })
    if (!rel) return null
  }

  return prisma.vehicle.findFirst({
    where,
    include: {
      fleet:             { select: { id: true, name: true } },
      maintenanceRecords: { orderBy: { startedAt: 'desc' }, take: 5 },
      _count:            { select: { loads: true } }
    }
  })
}

// ─── Update Vehicle ────────────────────────────────────────────
export async function updateVehicle(vehicleId, data, { actorId, actorRole, actorEmail, ipAddress, fleetId }) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })

  if (!vehicle) return { error: 'NOT_FOUND', message: 'Vehicle not found.' }
  if (actorRole === 'FLEET_ADMIN' && vehicle.fleetId !== fleetId) return { error: 'NOT_FOUND' }
  if (vehicle.status === 'INACTIVE') return { error: 'INACTIVE', message: 'Cannot update an inactive vehicle. Reactivate it first.' }

  const updated = await prisma.vehicle.update({ where: { id: vehicleId }, data })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'UPDATE',
    description: `Vehicle ${vehicle.plateNumber} updated.`,
    entityType:  'Vehicle',
    entityId:    vehicleId,
    oldValue:    vehicle,
    newValue:    data,
    ipAddress
  })

  return { vehicle: updated }
}

// ─── Deactivate Vehicle ────────────────────────────────────────
export async function deactivateVehicle(vehicleId, { actorId, actorRole, actorEmail, ipAddress, fleetId }) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })

  if (!vehicle) return { error: 'NOT_FOUND' }
  if (actorRole === 'FLEET_ADMIN' && vehicle.fleetId !== fleetId) return { error: 'NOT_FOUND' }
  if (vehicle.status === 'INACTIVE') return { error: 'ALREADY_INACTIVE', message: 'Vehicle is already inactive.' }

  const activeLoad = await prisma.load.findFirst({
    where: { vehicleId, status: { in: ACTIVE_LOAD_STATUSES } }
  })
  if (activeLoad) return { error: 'HAS_ACTIVE_LOADS', message: 'Cannot deactivate a vehicle with active loads.' }

  await prisma.vehicle.update({ where: { id: vehicleId }, data: { status: 'INACTIVE' } })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'DEACTIVATE',
    description: `Vehicle ${vehicle.plateNumber} deactivated.`,
    entityType:  'Vehicle',
    entityId:    vehicleId,
    oldValue:    { status: vehicle.status },
    newValue:    { status: 'INACTIVE' },
    ipAddress
  })

  return { success: true }
}

// ─── Reactivate Vehicle ────────────────────────────────────────
export async function reactivateVehicle(vehicleId, { actorId, actorRole, actorEmail, ipAddress, fleetId }) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })

  if (!vehicle) return { error: 'NOT_FOUND' }
  if (actorRole === 'FLEET_ADMIN' && vehicle.fleetId !== fleetId) return { error: 'NOT_FOUND' }
  if (vehicle.status !== 'INACTIVE') return { error: 'NOT_INACTIVE', message: `Vehicle is not inactive (current status: ${vehicle.status}).` }

  await prisma.vehicle.update({ where: { id: vehicleId }, data: { status: 'AVAILABLE' } })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'REACTIVATE',
    description: `Vehicle ${vehicle.plateNumber} reactivated.`,
    entityType:  'Vehicle',
    entityId:    vehicleId,
    oldValue:    { status: vehicle.status },
    newValue:    { status: 'AVAILABLE' },
    ipAddress
  })

  return { success: true }
}

// ─── Start Maintenance ─────────────────────────────────────────
// Sets vehicle status to UNDER_MAINTENANCE and opens a MaintenanceRecord.
// Rule (Section 22): Never assign a vehicle under maintenance to a load.
export async function startMaintenance(vehicleId, { reason, notes, actorId, actorRole, actorEmail, ipAddress, fleetId }) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })

  if (!vehicle) return { error: 'NOT_FOUND', message: 'Vehicle not found.' }
  if (actorRole === 'FLEET_ADMIN' && vehicle.fleetId !== fleetId) return { error: 'NOT_FOUND' }
  if (vehicle.status === 'UNDER_MAINTENANCE') return { error: 'ALREADY_IN_MAINTENANCE', message: 'Vehicle is already under maintenance.' }
  if (vehicle.status === 'INACTIVE')          return { error: 'INACTIVE',               message: 'Cannot put an inactive vehicle into maintenance.' }
  if (vehicle.status === 'ON_LOAD')           return { error: 'ON_LOAD',                message: 'Cannot put a vehicle on an active load into maintenance.' }

  const now = new Date()

  const [record] = await prisma.$transaction([
    prisma.maintenanceRecord.create({
      data: {
        vehicleId,
        startedAt:    now,
        reason:       reason ?? null,
        notes:        notes  ?? null,
        startedById:  actorId
      }
    }),
    prisma.vehicle.update({
      where: { id: vehicleId },
      data:  {
        status:               'UNDER_MAINTENANCE',
        maintenanceStartedAt: now,
        maintenanceReason:    reason ?? null
      }
    })
  ])

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'MAINTENANCE_START',
    description: `Vehicle ${vehicle.plateNumber} placed under maintenance. Reason: ${reason ?? 'Not specified'}.`,
    entityType:  'Vehicle',
    entityId:    vehicleId,
    oldValue:    { status: vehicle.status },
    newValue:    { status: 'UNDER_MAINTENANCE', reason },
    ipAddress
  })

  return { record }
}

// ─── Complete Maintenance ──────────────────────────────────────
// Closes the open MaintenanceRecord and sets vehicle back to AVAILABLE.
export async function completeMaintenance(vehicleId, { notes, actorId, actorRole, actorEmail, ipAddress, fleetId }) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })

  if (!vehicle) return { error: 'NOT_FOUND', message: 'Vehicle not found.' }
  if (actorRole === 'FLEET_ADMIN' && vehicle.fleetId !== fleetId) return { error: 'NOT_FOUND' }
  if (vehicle.status !== 'UNDER_MAINTENANCE') {
    return { error: 'NOT_IN_MAINTENANCE', message: `Vehicle is not under maintenance (current status: ${vehicle.status}).` }
  }

  // Find the open maintenance record
  const openRecord = await prisma.maintenanceRecord.findFirst({
    where:   { vehicleId, completedAt: null },
    orderBy: { startedAt: 'desc' }
  })

  if (!openRecord) return { error: 'NO_OPEN_RECORD', message: 'No open maintenance record found for this vehicle.' }

  const now = new Date()

  const [record] = await prisma.$transaction([
    prisma.maintenanceRecord.update({
      where: { id: openRecord.id },
      data:  { completedAt: now, completedById: actorId, notes: notes ?? openRecord.notes }
    }),
    prisma.vehicle.update({
      where: { id: vehicleId },
      data:  { status: 'AVAILABLE', maintenanceStartedAt: null, maintenanceReason: null }
    })
  ])

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'MAINTENANCE_COMPLETE',
    description: `Vehicle ${vehicle.plateNumber} maintenance completed.`,
    entityType:  'Vehicle',
    entityId:    vehicleId,
    oldValue:    { status: vehicle.status },
    newValue:    { status: 'AVAILABLE' },
    ipAddress
  })

  return { record }
}

// ─── List Maintenance Records ──────────────────────────────────
export async function listMaintenanceRecords(vehicleId, { page = 1, perPage = 20, isolation } = {}) {
  // Verify vehicle is accessible
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
  if (!vehicle) return null

  if (isolation.role === 'FLEET_ADMIN' && vehicle.fleetId !== isolation.fleetId) return null

  const skip  = (page - 1) * perPage

  const [records, total] = await Promise.all([
    prisma.maintenanceRecord.findMany({
      where:   { vehicleId },
      skip,
      take:    perPage,
      orderBy: { startedAt: 'desc' }
    }),
    prisma.maintenanceRecord.count({ where: { vehicleId } })
  ])

  return { data: records, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } }
}
