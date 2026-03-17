import { prisma } from './prisma.service.js'
import { storageService } from './storage.service.js'
import { writeAuditLog } from '../middleware/audit.middleware.js'
import {
  sendLoadAssigned,
  sendDeliverySubmitted,
  sendLoadCompleted
} from './email.service.js'
import { generateInvoice } from './invoice.service.js'
import { createNotification } from './notification.service.js'

// ─── Serial Number Generator ───────────────────────────────────
// Format: LOAD-{year}-{5-digit-sequence}, e.g. LOAD-2026-00001
async function generateSerialNumber() {
  const year   = new Date().getFullYear()
  const prefix = `LOAD-${year}-`
  const count  = await prisma.load.count({ where: { serialNumber: { startsWith: prefix } } })
  return `${prefix}${String(count + 1).padStart(5, '0')}`
}

// ─── Record Status Change ──────────────────────────────────────
async function recordStatusChange(tx, { loadId, status, changedById, changedByRole, note }) {
  await tx.loadStatusHistory.create({
    data: { loadId, status, changedById, changedByRole, note: note ?? null }
  })
}

// ─── Resolve Commission ────────────────────────────────────────
// Uses per-fleet commission if relationship exists, else agency default
async function resolveCommission(agencyId, fleetId) {
  if (fleetId) {
    const rel = await prisma.agencyFleetRelationship.findUnique({
      where: { agencyId_fleetId: { agencyId, fleetId } }
    })
    if (rel) return rel.commissionPercent
  }
  const agency = await prisma.agency.findUnique({
    where:  { id: agencyId },
    select: { commissionPercent: true }
  })
  return agency?.commissionPercent ?? 8.0
}

// ─── Validate Assignment ───────────────────────────────────────
// Enforces Section 22 rules before any assignment
async function validateAssignment(agencyId, fleetId, driverId, vehicleId) {
  const [fleet, driver, vehicle] = await Promise.all([
    prisma.fleet.findUnique({ where: { id: fleetId } }),
    prisma.driver.findUnique({ where: { id: driverId } }),
    prisma.vehicle.findUnique({ where: { id: vehicleId } })
  ])

  if (!fleet  || fleet.status  !== 'ACTIVE')  return { error: 'INVALID_FLEET',  message: 'Fleet not found or not active.' }
  if (!driver || driver.status === 'INACTIVE') return { error: 'INVALID_DRIVER', message: 'Driver not found or inactive.' }
  if (!driver || driver.status === 'ON_LOAD')  return { error: 'DRIVER_ON_LOAD', message: 'Driver is already on an active load.' }
  if (!vehicle)                                return { error: 'INVALID_VEHICLE', message: 'Vehicle not found.' }

  // Never assign a vehicle under maintenance (Section 22 rule)
  if (vehicle.status === 'UNDER_MAINTENANCE') return { error: 'VEHICLE_IN_MAINTENANCE', message: 'Cannot assign a vehicle that is under maintenance.' }
  if (vehicle.status === 'ON_LOAD')           return { error: 'VEHICLE_ON_LOAD',         message: 'Vehicle is already assigned to an active load.' }
  if (vehicle.status === 'INACTIVE')          return { error: 'VEHICLE_INACTIVE',         message: 'Cannot assign an inactive vehicle.' }

  // Never assign a driver from a different fleet (Section 22 rule)
  if (driver.fleetId !== fleetId)   return { error: 'DRIVER_FLEET_MISMATCH', message: 'Driver does not belong to the assigned fleet.' }
  if (vehicle.fleetId !== fleetId)  return { error: 'VEHICLE_FLEET_MISMATCH', message: 'Vehicle does not belong to the assigned fleet.' }

  // Fleet must have active relationship with the agency
  const rel = await prisma.agencyFleetRelationship.findFirst({
    where: { agencyId, fleetId, status: 'ACTIVE' }
  })
  if (!rel) return { error: 'NO_RELATIONSHIP', message: 'Fleet has no active relationship with this agency.' }

  return { ok: true, fleet, driver, vehicle, rel }
}

// ─── Create Load ───────────────────────────────────────────────
// Dispatcher creates a load. If fleetId + driverId + vehicleId are all provided,
// assignment is done immediately (ASSIGNED). Otherwise DRAFT.
export async function createLoad(data, { actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const { fleetId, driverId, vehicleId, loadRate, notes, loadNumber, ...rest } = data

  const isFullAssignment = !!(fleetId && driverId && vehicleId)

  let commissionPercent = await resolveCommission(agencyId, fleetId ?? null)
  const commissionAmount = +(loadRate * commissionPercent / 100).toFixed(2)
  const fleetEarnings    = +(loadRate - commissionAmount).toFixed(2)

  // Validate assignment if all three provided
  if (isFullAssignment) {
    const check = await validateAssignment(agencyId, fleetId, driverId, vehicleId)
    if (check.error) return check
    commissionPercent = +(check.rel.commissionPercent)
  }

  const serialNumber = await generateSerialNumber()
  const status       = isFullAssignment ? 'ASSIGNED' : 'DRAFT'
  const now          = new Date()

  const load = await prisma.$transaction(async (tx) => {
    const l = await tx.load.create({
      data: {
        serialNumber,
        loadNumber:   loadNumber ?? null,
        agencyId,
        dispatcherId: actorId,
        fleetId:      fleetId   ?? null,
        driverId:     driverId  ?? null,
        vehicleId:    vehicleId ?? null,
        loadRate,
        commissionPercent,
        commissionAmount,
        fleetEarnings,
        dispatcherEarnings: 0,
        status,
        notes: notes ?? null,
        ...rest
      }
    })

    await recordStatusChange(tx, { loadId: l.id, status, changedById: actorId, changedByRole: actorRole })

    // Lock vehicle when assigned
    if (isFullAssignment) {
      await tx.vehicle.update({ where: { id: vehicleId }, data: { status: 'ON_LOAD' } })
    }

    return l
  })

  // Notify driver if assigned
  if (isFullAssignment) {
    await notifyLoadAssigned(load, agencyId)
  }

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'CREATE',
    description: `Load ${serialNumber} created${isFullAssignment ? ' and assigned' : ' as draft'}.`,
    entityType:  'Load',
    entityId:    load.id,
    newValue:    { serialNumber, status, agencyId },
    ipAddress,
    agencyId
  })

  return { load }
}

// ─── Assign Load ───────────────────────────────────────────────
// Assigns a DRAFT load to a fleet, driver, and vehicle → ASSIGNED.
export async function assignLoad(loadId, { fleetId, driverId, vehicleId, actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const load = await prisma.load.findUnique({ where: { id: loadId } })

  if (!load)                         return { error: 'NOT_FOUND',       message: 'Load not found.' }
  if (load.agencyId !== agencyId && actorRole !== 'SUPER_ADMIN') return { error: 'NOT_FOUND' }
  if (load.status !== 'DRAFT')       return { error: 'INVALID_STATUS',  message: `Only DRAFT loads can be assigned (current: ${load.status}).` }

  const check = await validateAssignment(agencyId, fleetId, driverId, vehicleId)
  if (check.error) return check

  const commissionPercent = +(check.rel.commissionPercent)
  const commissionAmount  = +(load.loadRate * commissionPercent / 100).toFixed(2)
  const fleetEarnings     = +(load.loadRate - commissionAmount).toFixed(2)

  const updated = await prisma.$transaction(async (tx) => {
    const l = await tx.load.update({
      where: { id: loadId },
      data:  { fleetId, driverId, vehicleId, commissionPercent, commissionAmount, fleetEarnings, status: 'ASSIGNED' }
    })
    await recordStatusChange(tx, { loadId, status: 'ASSIGNED', changedById: actorId, changedByRole: actorRole })
    await tx.vehicle.update({ where: { id: vehicleId }, data: { status: 'ON_LOAD' } })
    return l
  })

  await notifyLoadAssigned(updated, agencyId)

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'ASSIGN',
    description: `Load ${load.serialNumber} assigned to fleet ${fleetId}.`,
    entityType:  'Load',
    entityId:    loadId,
    oldValue:    { status: 'DRAFT' },
    newValue:    { status: 'ASSIGNED', fleetId, driverId, vehicleId },
    ipAddress,
    agencyId
  })

  return { load: updated }
}

// ─── Update Load ───────────────────────────────────────────────
// Only DRAFT loads can be fully updated. ASSIGNED loads: notes only.
export async function updateLoad(loadId, data, { actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const load = await prisma.load.findUnique({ where: { id: loadId } })

  if (!load) return { error: 'NOT_FOUND', message: 'Load not found.' }
  if (load.agencyId !== agencyId && actorRole !== 'SUPER_ADMIN') return { error: 'NOT_FOUND' }

  if (load.status !== 'DRAFT' && load.status !== 'ASSIGNED') {
    return { error: 'INVALID_STATUS', message: `Load cannot be updated with status "${load.status}".` }
  }

  // ASSIGNED loads: only notes can be updated
  const allowedData = load.status === 'ASSIGNED'
    ? { notes: data.notes }
    : data

  const updated = await prisma.load.update({ where: { id: loadId }, data: allowedData })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'UPDATE',
    description: `Load ${load.serialNumber} updated.`,
    entityType:  'Load',
    entityId:    loadId,
    oldValue:    load,
    newValue:    allowedData,
    ipAddress,
    agencyId
  })

  return { load: updated }
}

// ─── Start Trip ────────────────────────────────────────────────
// Driver marks trip as started → IN_TRANSIT. Sets driver status to ON_LOAD.
export async function startTrip(loadId, { actorId, actorRole, actorEmail, ipAddress }) {
  const load = await prisma.load.findUnique({ where: { id: loadId } })

  if (!load)                       return { error: 'NOT_FOUND',      message: 'Load not found.' }
  if (load.driverId !== actorId)   return { error: 'FORBIDDEN',      message: 'You are not assigned to this load.' }
  if (load.status !== 'ASSIGNED')  return { error: 'INVALID_STATUS', message: `Load must be ASSIGNED to start trip (current: ${load.status}).` }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.load.update({ where: { id: loadId }, data: { status: 'IN_TRANSIT', tripStartedAt: now } })
    await recordStatusChange(tx, { loadId, status: 'IN_TRANSIT', changedById: actorId, changedByRole: actorRole })
    await tx.driver.update({ where: { id: actorId }, data: { status: 'ON_LOAD' } })
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'TRIP_START',
    description: `Load ${load.serialNumber} trip started.`,
    entityType:  'Load',
    entityId:    loadId,
    oldValue:    { status: 'ASSIGNED' },
    newValue:    { status: 'IN_TRANSIT', tripStartedAt: now },
    ipAddress,
    agencyId:    load.agencyId
  })

  return { success: true }
}

// ─── Submit Delivery / Upload POD ─────────────────────────────
// Driver uploads proof of delivery → PENDING_DELIVERY_CONFIRMATION.
// Notifies dispatcher to review.
export async function submitDelivery(loadId, podFile, { actorId, actorRole, actorEmail, ipAddress }) {
  const load = await prisma.load.findUnique({ where: { id: loadId } })

  if (!load)                          return { error: 'NOT_FOUND',      message: 'Load not found.' }
  if (load.driverId !== actorId)      return { error: 'FORBIDDEN',      message: 'You are not assigned to this load.' }
  if (load.status !== 'IN_TRANSIT')   return { error: 'INVALID_STATUS', message: `Load must be IN_TRANSIT to submit delivery (current: ${load.status}).` }
  if (!podFile)                       return { error: 'NO_FILE',         message: 'POD file is required.' }

  // Upload POD to Supabase Storage — pod-files bucket (private)
  const podStoragePath = await storageService.uploadPOD(podFile, loadId)
  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.load.update({
      where: { id: loadId },
      data:  { status: 'PENDING_DELIVERY_CONFIRMATION', podFileUrl: podStoragePath, deliverySubmittedAt: now }
    })
    await recordStatusChange(tx, {
      loadId, status: 'PENDING_DELIVERY_CONFIRMATION',
      changedById: actorId, changedByRole: actorRole,
      note: 'POD submitted by driver'
    })
  })

  // Notify dispatcher
  await notifyDeliverySubmitted(load)

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'POD_SUBMIT',
    description: `POD submitted for load ${load.serialNumber}.`,
    entityType:  'Load',
    entityId:    loadId,
    newValue:    { podStoragePath, deliverySubmittedAt: now },
    ipAddress,
    agencyId:    load.agencyId
  })

  return { success: true }
}

// ─── Accept Delivery ───────────────────────────────────────────
// Dispatcher accepts POD → COMPLETED. Frees driver and vehicle.
// Invoice generation is triggered by Module 10 (hooks into COMPLETED status).
export async function acceptDelivery(loadId, { actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const load = await prisma.load.findUnique({ where: { id: loadId } })

  if (!load)                         return { error: 'NOT_FOUND',      message: 'Load not found.' }
  if (load.agencyId !== agencyId && actorRole !== 'SUPER_ADMIN') return { error: 'NOT_FOUND' }
  if (load.status !== 'PENDING_DELIVERY_CONFIRMATION') {
    return { error: 'INVALID_STATUS', message: `Load must be PENDING_DELIVERY_CONFIRMATION to accept (current: ${load.status}).` }
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.load.update({
      where: { id: loadId },
      data:  { status: 'COMPLETED', deliveryAcceptedAt: now, completedAt: now }
    })
    await recordStatusChange(tx, {
      loadId, status: 'COMPLETED',
      changedById: actorId, changedByRole: actorRole,
      note: 'Delivery accepted by dispatcher'
    })
    // Free driver and vehicle
    if (load.driverId)  await tx.driver.update({ where: { id: load.driverId },  data: { status: 'ACTIVE' } })
    if (load.vehicleId) await tx.vehicle.update({ where: { id: load.vehicleId }, data: { status: 'AVAILABLE' } })
  })

  // Notify all parties
  await notifyLoadCompleted(load, agencyId)

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'DELIVERY_ACCEPT',
    description: `Delivery accepted for load ${load.serialNumber}. Load COMPLETED.`,
    entityType:  'Load',
    entityId:    loadId,
    oldValue:    { status: load.status },
    newValue:    { status: 'COMPLETED', completedAt: now },
    ipAddress,
    agencyId
  })

  // Auto-generate invoice for the completed load (Module 10)
  generateInvoice(loadId).catch(err =>
    console.error(`[Load] Invoice generation failed for ${loadId}:`, err.message)
  )

  return { success: true }
}

// ─── Reject Delivery ───────────────────────────────────────────
// Dispatcher rejects POD → back to IN_TRANSIT. Driver must resubmit.
export async function rejectDelivery(loadId, { reason, actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const load = await prisma.load.findUnique({ where: { id: loadId } })

  if (!load)                         return { error: 'NOT_FOUND',      message: 'Load not found.' }
  if (load.agencyId !== agencyId && actorRole !== 'SUPER_ADMIN') return { error: 'NOT_FOUND' }
  if (load.status !== 'PENDING_DELIVERY_CONFIRMATION') {
    return { error: 'INVALID_STATUS', message: `Load must be PENDING_DELIVERY_CONFIRMATION to reject (current: ${load.status}).` }
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.load.update({
      where: { id: loadId },
      data:  {
        status:                  'IN_TRANSIT',
        deliveryRejectedAt:      now,
        deliveryRejectionReason: reason,
        podFileUrl:              null   // clear rejected POD — driver must resubmit
      }
    })
    await recordStatusChange(tx, {
      loadId, status: 'IN_TRANSIT',
      changedById: actorId, changedByRole: actorRole,
      note: `Delivery rejected: ${reason}`
    })
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'DELIVERY_REJECT',
    description: `Delivery rejected for load ${load.serialNumber}. Reason: ${reason}.`,
    entityType:  'Load',
    entityId:    loadId,
    oldValue:    { status: load.status },
    newValue:    { status: 'IN_TRANSIT', deliveryRejectionReason: reason },
    ipAddress,
    agencyId
  })

  return { success: true }
}

// ─── Cancel Load ───────────────────────────────────────────────
// Any pre-COMPLETED load can be cancelled by dispatcher, agency admin, or super admin.
// Restores driver and vehicle to available based on current status.
export async function cancelLoad(loadId, { reason, actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const load = await prisma.load.findUnique({ where: { id: loadId } })

  if (!load) return { error: 'NOT_FOUND', message: 'Load not found.' }

  // Scope check for agency roles
  if (actorRole === 'AGENCY_ADMIN' || actorRole === 'DISPATCHER') {
    if (load.agencyId !== agencyId) return { error: 'NOT_FOUND' }
  }
  if (actorRole === 'FLEET_ADMIN') {
    // Fleet admin can cancel if load is assigned to their fleet and is IN_TRANSIT or PENDING
    const fleetAdmin = await prisma.fleetAdmin.findUnique({ where: { id: actorId } })
    if (!fleetAdmin || load.fleetId !== fleetAdmin.fleetId) return { error: 'NOT_FOUND' }
    if (!['IN_TRANSIT', 'PENDING_DELIVERY_CONFIRMATION'].includes(load.status)) {
      return { error: 'FORBIDDEN', message: 'Fleet admin can only cancel loads that are in transit or pending confirmation.' }
    }
  }

  if (load.status === 'COMPLETED') return { error: 'ALREADY_COMPLETED', message: 'Cannot cancel a completed load.' }
  if (load.status === 'CANCELLED') return { error: 'ALREADY_CANCELLED', message: 'Load is already cancelled.' }

  const now = new Date()
  const wasInTransitOrLater = ['IN_TRANSIT', 'PENDING_DELIVERY_CONFIRMATION'].includes(load.status)
  const wasAssigned         = load.status === 'ASSIGNED'

  await prisma.$transaction(async (tx) => {
    await tx.load.update({
      where: { id: loadId },
      data:  {
        status:             'CANCELLED',
        cancellationReason: reason ?? null,
        cancelledAt:        now,
        cancelledById:      actorId,
        cancelledByRole:    actorRole
      }
    })
    await recordStatusChange(tx, {
      loadId, status: 'CANCELLED',
      changedById: actorId, changedByRole: actorRole,
      note: reason ?? null
    })

    // Restore driver if they were on this load
    if (wasInTransitOrLater && load.driverId) {
      await tx.driver.update({ where: { id: load.driverId }, data: { status: 'ACTIVE' } })
    }
    // Restore vehicle if it was locked
    if ((wasAssigned || wasInTransitOrLater) && load.vehicleId) {
      await tx.vehicle.update({ where: { id: load.vehicleId }, data: { status: 'AVAILABLE' } })
    }
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'CANCEL',
    description: `Load ${load.serialNumber} cancelled. Reason: ${reason ?? 'Not specified'}.`,
    entityType:  'Load',
    entityId:    loadId,
    oldValue:    { status: load.status },
    newValue:    { status: 'CANCELLED', cancellationReason: reason },
    ipAddress,
    agencyId:    load.agencyId
  })

  return { success: true }
}

// ─── List Loads ────────────────────────────────────────────────
export async function listLoads({ page = 1, perPage = 20, status, isolation } = {}) {
  const skip  = (page - 1) * perPage
  const where = {}

  if (status) where.status = status

  switch (isolation.role) {
    case 'DISPATCHER':
      where.agencyId     = isolation.agencyId
      where.dispatcherId = isolation.dispatcherId
      break
    case 'AGENCY_ADMIN':
      where.agencyId = isolation.agencyId
      break
    case 'FLEET_ADMIN':
      where.fleetId = isolation.fleetId
      break
    case 'DRIVER':
      where.driverId = isolation.driverId
      break
    // SUPER_ADMIN: no restriction
  }

  const [loads, total] = await Promise.all([
    prisma.load.findMany({
      where,
      skip,
      take:    perPage,
      orderBy: { createdAt: 'desc' },
      include: {
        dispatcher: { select: { id: true, name: true } },
        fleet:      { select: { id: true, name: true } },
        driver:     { select: { id: true, name: true } },
        vehicle:    { select: { id: true, make: true, model: true, plateNumber: true } }
      }
    }),
    prisma.load.count({ where })
  ])

  return { data: loads, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } }
}

// ─── Get Load By ID ────────────────────────────────────────────
export async function getLoadById(loadId, isolation) {
  const where = { id: loadId }

  switch (isolation.role) {
    case 'DISPATCHER':
      where.agencyId     = isolation.agencyId
      where.dispatcherId = isolation.dispatcherId
      break
    case 'AGENCY_ADMIN':
      where.agencyId = isolation.agencyId
      break
    case 'FLEET_ADMIN':
      where.fleetId = isolation.fleetId
      break
    case 'DRIVER':
      where.driverId = isolation.driverId
      break
  }

  return prisma.load.findFirst({
    where,
    include: {
      dispatcher:    { select: { id: true, name: true, email: true } },
      fleet:         { select: { id: true, name: true } },
      driver:        { select: { id: true, name: true, phone: true } },
      vehicle:       { select: { id: true, make: true, model: true, plateNumber: true, vehicleType: true } },
      statusHistory: { orderBy: { changedAt: 'asc' } }
    }
  })
}

// ─── Get POD Signed URL ────────────────────────────────────────
export async function getLoadPOD(loadId, isolation) {
  const load = await getLoadById(loadId, isolation)
  if (!load)          return { error: 'NOT_FOUND',  message: 'Load not found.' }
  if (!load.podFileUrl) return { error: 'NO_POD',   message: 'No proof of delivery on file for this load.' }

  const signedUrl = await storageService.getSignedUrl(
    process.env.STORAGE_BUCKET_POD,
    load.podFileUrl
  )

  return { signedUrl }
}

// ──────────────────────────────────────────────────────────────
// Private helpers for email notifications
// ──────────────────────────────────────────────────────────────

async function notifyLoadAssigned(load, agencyId) {
  if (!load.driverId) return
  try {
    const [driver, agency] = await Promise.all([
      prisma.driver.findUnique({ where: { id: load.driverId }, select: { email: true, name: true } }),
      prisma.agency.findUnique({ where: { id: agencyId } })
    ])
    if (driver && agency) {
      await sendLoadAssigned({ to: driver.email, driverName: driver.name, load, agency })
    }
    await createNotification({
      userId:   load.driverId,
      userRole: 'DRIVER',
      agencyId,
      type:     'LOAD_ASSIGNED',
      title:    'New load assigned',
      message:  `Load ${load.serialNumber} has been assigned to you.`,
      data:     { loadId: load.id, serialNumber: load.serialNumber }
    })
  } catch (err) {
    console.error('[Load] Failed to send assignment notification:', err.message)
  }
}

async function notifyDeliverySubmitted(load) {
  try {
    const dispatcher = await prisma.dispatcher.findUnique({
      where:  { id: load.dispatcherId },
      select: { email: true, name: true }
    })
    const agency = await prisma.agency.findUnique({ where: { id: load.agencyId } })
    if (dispatcher && agency) {
      await sendDeliverySubmitted({ to: dispatcher.email, dispatcherName: dispatcher.name, load, agency })
    }
    await createNotification({
      userId:   load.dispatcherId,
      userRole: 'DISPATCHER',
      agencyId: load.agencyId,
      type:     'DELIVERY_SUBMITTED',
      title:    'Proof of delivery submitted',
      message:  `Driver submitted POD for load ${load.serialNumber}. Review and confirm.`,
      data:     { loadId: load.id, serialNumber: load.serialNumber }
    })
  } catch (err) {
    console.error('[Load] Failed to send POD notification:', err.message)
  }
}

async function notifyLoadCompleted(load, agencyId) {
  try {
    const [dispatcher, agency] = await Promise.all([
      prisma.dispatcher.findUnique({ where: { id: load.dispatcherId }, select: { email: true, name: true } }),
      prisma.agency.findUnique({ where: { id: agencyId } })
    ])
    if (dispatcher && agency) {
      await sendLoadCompleted({ to: dispatcher.email, recipientName: dispatcher.name, load, agency })
    }
    await createNotification({
      userId:   load.dispatcherId,
      userRole: 'DISPATCHER',
      agencyId,
      type:     'LOAD_COMPLETED',
      title:    'Load completed',
      message:  `Load ${load.serialNumber} has been completed and an invoice has been generated.`,
      data:     { loadId: load.id, serialNumber: load.serialNumber }
    })
    // Also notify fleet admin
    if (load.fleetId) {
      const fleetAdmin = await prisma.fleetAdmin.findUnique({
        where:  { fleetId: load.fleetId },
        select: { id: true, email: true, name: true }
      })
      if (fleetAdmin && agency) {
        await sendLoadCompleted({ to: fleetAdmin.email, recipientName: fleetAdmin.name, load, agency })
        await createNotification({
          userId:   fleetAdmin.id,
          userRole: 'FLEET_ADMIN',
          agencyId,
          type:     'LOAD_COMPLETED',
          title:    'Load completed — invoice incoming',
          message:  `Load ${load.serialNumber} is complete. An invoice will be generated shortly.`,
          data:     { loadId: load.id, serialNumber: load.serialNumber }
        })
      }
    }
  } catch (err) {
    console.error('[Load] Failed to send completion email:', err.message)
  }
}
