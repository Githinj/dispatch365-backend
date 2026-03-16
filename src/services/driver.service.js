import bcrypt from 'bcryptjs'
import { v4 as uuid } from 'uuid'
import { prisma } from './prisma.service.js'
import { storageService } from './storage.service.js'
import { sessionService } from './redis.service.js'
import { writeAuditLog } from '../middleware/audit.middleware.js'
import { sendDriverInvite } from './email.service.js'

const INVITE_TOKEN_TTL_HOURS = 48

// Active load statuses — used to enforce "never transfer with active loads" rule
const ACTIVE_LOAD_STATUSES = ['ASSIGNED', 'IN_TRANSIT', 'PENDING_DELIVERY_CONFIRMATION']

// ─── Invite Driver ─────────────────────────────────────────────
// Fleet Admin creates a driver record and sends an invite link to set their password.
export async function inviteDriver({ fleetId, name, email, phone, actorId, actorEmail, ipAddress }) {
  const lower = email.toLowerCase().trim()

  const [fleet, existing] = await Promise.all([
    prisma.fleet.findUnique({ where: { id: fleetId }, select: { id: true, name: true } }),
    prisma.driver.findUnique({ where: { email: lower } })
  ])

  if (!fleet)   return { error: 'NOT_FOUND',    message: 'Fleet not found.' }
  if (existing) return { error: 'EMAIL_IN_USE', message: 'A driver with this email already exists.' }

  const token  = uuid()
  const expiry = new Date(Date.now() + INVITE_TOKEN_TTL_HOURS * 60 * 60 * 1000)

  const driver = await prisma.driver.create({
    data: {
      fleetId,
      name,
      email:             lower,
      phone:             phone ?? null,
      status:            'PENDING',
      inviteToken:       token,
      inviteTokenExpiry: expiry
    }
  })

  const inviteUrl = `${process.env.FRONTEND_URL}/accept-invite/driver/${token}`
  await sendDriverInvite({ to: lower, driverName: name, fleetName: fleet.name, inviteUrl })

  await writeAuditLog({
    actorId,
    actorRole:   'FLEET_ADMIN',
    actorEmail,
    actionType:  'INVITE',
    description: `Driver invite sent to "${name}" (${lower}).`,
    entityType:  'Driver',
    entityId:    driver.id,
    newValue:    { name, email: lower, fleetId },
    ipAddress
  })

  return { driver }
}

// ─── Resend Driver Invite ──────────────────────────────────────
export async function resendDriverInvite(driverId, { actorId, actorEmail, ipAddress }) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } })

  if (!driver) return { error: 'NOT_FOUND', message: 'Driver not found.' }
  if (driver.status !== 'PENDING') {
    return { error: 'INVALID_STATUS', message: 'Can only resend invite for drivers with PENDING status.' }
  }

  const token  = uuid()
  const expiry = new Date(Date.now() + INVITE_TOKEN_TTL_HOURS * 60 * 60 * 1000)

  await prisma.driver.update({
    where: { id: driverId },
    data:  { inviteToken: token, inviteTokenExpiry: expiry }
  })

  const fleet = await prisma.fleet.findUnique({
    where:  { id: driver.fleetId },
    select: { name: true }
  })

  const inviteUrl = `${process.env.FRONTEND_URL}/accept-invite/driver/${token}`
  await sendDriverInvite({ to: driver.email, driverName: driver.name, fleetName: fleet?.name ?? '', inviteUrl })

  await writeAuditLog({
    actorId,
    actorRole:   'FLEET_ADMIN',
    actorEmail,
    actionType:  'RESEND_INVITE',
    description: `Driver invite resent to "${driver.name}" (${driver.email}).`,
    entityType:  'Driver',
    entityId:    driverId,
    ipAddress
  })

  return { success: true }
}

// ─── Validate Invite Token ─────────────────────────────────────
export async function validateInviteToken(token) {
  const driver = await prisma.driver.findUnique({ where: { inviteToken: token } })

  if (!driver) return { error: 'INVALID_TOKEN', message: 'Invalid invite link.' }
  if (driver.status !== 'PENDING') return { error: 'TOKEN_USED', message: 'This invite link has already been used.' }
  if (driver.inviteTokenExpiry < new Date()) {
    return { error: 'TOKEN_EXPIRED', message: 'This invite link has expired. Please ask your fleet admin to resend.' }
  }

  const fleet = await prisma.fleet.findUnique({
    where:  { id: driver.fleetId },
    select: { name: true }
  })

  return {
    driver: { id: driver.id, name: driver.name, email: driver.email, fleetName: fleet?.name ?? null }
  }
}

// ─── Accept Invite ─────────────────────────────────────────────
// Public — driver sets password and activates their account.
export async function acceptInvite(token, { password }) {
  const found = await validateInviteToken(token)
  if (found.error) return found

  const driver = await prisma.driver.findUnique({ where: { inviteToken: token } })
  const hashed = await bcrypt.hash(password, 12)

  const updated = await prisma.$transaction(async (tx) => {
    const d = await tx.driver.update({
      where: { id: driver.id },
      data: {
        password:          hashed,
        status:            'ACTIVE',
        inviteToken:       null,
        inviteTokenExpiry: null
      }
    })

    // Record fleet history start
    await tx.driverFleetHistory.create({
      data: { driverId: driver.id, fleetId: driver.fleetId, startedAt: new Date(), reason: 'INITIAL' }
    })

    return d
  })

  return { driver: updated }
}

// ─── List Drivers ──────────────────────────────────────────────
export async function listDrivers({ page = 1, perPage = 20, status, isolation } = {}) {
  const skip  = (page - 1) * perPage
  const where = {}

  if (status) where.status = status

  if (isolation.role === 'FLEET_ADMIN' || isolation.role === 'DRIVER') {
    where.fleetId = isolation.fleetId
  }
  // SUPER_ADMIN: no restriction

  const [drivers, total] = await Promise.all([
    prisma.driver.findMany({
      where,
      skip,
      take:    perPage,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, fleetId: true, name: true, email: true, phone: true,
        status: true, licenseNumber: true, licenseClass: true, licenseExpiry: true,
        totalLoadsCompleted: true, onTimeDeliveryRate: true, overallRating: true,
        createdAt: true, updatedAt: true
      }
    }),
    prisma.driver.count({ where })
  ])

  return { data: drivers, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } }
}

// ─── Get Driver By ID ──────────────────────────────────────────
export async function getDriverById(driverId, isolation) {
  const where = { id: driverId }

  if (isolation.role === 'FLEET_ADMIN') {
    where.fleetId = isolation.fleetId
  } else if (isolation.role === 'DRIVER') {
    if (isolation.driverId !== driverId) return null
  }

  return prisma.driver.findFirst({
    where,
    include: {
      fleet:          { select: { id: true, name: true } },
      driverDocuments: { orderBy: { uploadedAt: 'desc' } },
      fleetHistory:   { orderBy: { startedAt: 'desc' } }
    }
  })
}

// ─── Update Driver Profile ─────────────────────────────────────
export async function updateDriverProfile(driverId, data, isolation) {
  if (isolation.role === 'DRIVER' && isolation.driverId !== driverId) return null

  if (isolation.role === 'FLEET_ADMIN') {
    const d = await prisma.driver.findUnique({ where: { id: driverId } })
    if (!d || d.fleetId !== isolation.fleetId) return null
  }

  return prisma.driver.update({ where: { id: driverId }, data })
}

// ─── Deactivate Driver ─────────────────────────────────────────
export async function deactivateDriver(driverId, { actorId, actorRole, actorEmail, ipAddress }) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } })

  if (!driver) return { error: 'NOT_FOUND' }
  if (actorRole === 'FLEET_ADMIN') {
    const fleet = await prisma.fleet.findUnique({ where: { id: driver.fleetId }, select: { fleetAdmin: { select: { id: true } } } })
    if (fleet?.fleetAdmin?.id !== actorId) return { error: 'NOT_FOUND' }
  }
  if (driver.status === 'INACTIVE') return { error: 'ALREADY_INACTIVE', message: 'Driver is already inactive.' }
  if (driver.status === 'ON_LOAD')  return { error: 'ON_LOAD', message: 'Cannot deactivate a driver who is currently on a load.' }

  // Check no active loads
  const activeLoad = await prisma.load.findFirst({
    where: { driverId, status: { in: ACTIVE_LOAD_STATUSES } }
  })
  if (activeLoad) return { error: 'HAS_ACTIVE_LOADS', message: 'Cannot deactivate a driver with active loads.' }

  await sessionService.destroy(driverId)
  await prisma.session.updateMany({
    where: { userId: driverId, isActive: true },
    data:  { isActive: false }
  })

  await prisma.$transaction(async (tx) => {
    await tx.driver.update({ where: { id: driverId }, data: { status: 'INACTIVE' } })
    await tx.driverFleetHistory.updateMany({
      where: { driverId, endedAt: null },
      data:  { endedAt: new Date() }
    })
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'DEACTIVATE',
    description: `Driver "${driver.name}" deactivated.`,
    entityType:  'Driver',
    entityId:    driverId,
    oldValue:    { status: driver.status },
    newValue:    { status: 'INACTIVE' },
    ipAddress
  })

  return { success: true }
}

// ─── Reactivate Driver ─────────────────────────────────────────
export async function reactivateDriver(driverId, { actorId, actorRole, actorEmail, ipAddress }) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } })

  if (!driver) return { error: 'NOT_FOUND' }
  if (driver.status === 'ACTIVE') return { error: 'ALREADY_ACTIVE', message: 'Driver is already active.' }
  if (driver.status !== 'INACTIVE') {
    return { error: 'INVALID_STATUS', message: `Cannot reactivate driver with status "${driver.status}".` }
  }

  await prisma.$transaction(async (tx) => {
    await tx.driver.update({ where: { id: driverId }, data: { status: 'ACTIVE' } })
    await tx.driverFleetHistory.create({
      data: { driverId, fleetId: driver.fleetId, startedAt: new Date(), reason: 'REACTIVATION' }
    })
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'REACTIVATE',
    description: `Driver "${driver.name}" reactivated.`,
    entityType:  'Driver',
    entityId:    driverId,
    oldValue:    { status: driver.status },
    newValue:    { status: 'ACTIVE' },
    ipAddress
  })

  return { success: true }
}

// ─── Upload Driver Document ────────────────────────────────────
export async function uploadDriverDocument(driverId, file, documentType, isRequired, { actorId, actorRole, actorEmail, ipAddress }) {
  const storagePath = await storageService.uploadDriverDocument(file, driverId, documentType)

  const doc = await prisma.driverDocument.create({
    data: {
      driverId,
      documentType,
      storagePath,
      fileName:   file.originalname,
      mimeType:   file.mimetype,
      isRequired: isRequired ?? false
    }
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'UPLOAD',
    description: `Driver document uploaded: ${documentType} (${file.originalname}).`,
    entityType:  'DriverDocument',
    entityId:    doc.id,
    newValue:    { documentType, fileName: file.originalname },
    ipAddress
  })

  return doc
}

// ─── Get Driver Documents (with signed URLs) ───────────────────
export async function getDriverDocuments(driverId, isolation) {
  // Verify driver is accessible
  if (isolation.role === 'DRIVER' && isolation.driverId !== driverId) return null
  if (isolation.role === 'FLEET_ADMIN') {
    const driver = await prisma.driver.findUnique({ where: { id: driverId } })
    if (!driver || driver.fleetId !== isolation.fleetId) return null
  }

  const docs = await prisma.driverDocument.findMany({
    where:   { driverId },
    orderBy: { uploadedAt: 'desc' }
  })

  return Promise.all(
    docs.map(async (doc) => {
      const signedUrl = await storageService.getSignedUrl(
        process.env.STORAGE_BUCKET_DRIVER_DOCS,
        doc.storagePath
      )
      return { ...doc, signedUrl }
    })
  )
}

// ──────────────────────────────────────────────────────────────
// TRANSFER FLOW (between fleets)
// ──────────────────────────────────────────────────────────────

// ─── Initiate Transfer ─────────────────────────────────────────
// Driver requests to move to another fleet. Both fleets must approve.
export async function initiateDriverTransfer(driverId, { toFleetId, actorId, actorEmail, ipAddress }) {
  const [driver, toFleet] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId } }),
    prisma.fleet.findUnique({ where: { id: toFleetId } })
  ])

  if (!driver)                             return { error: 'NOT_FOUND',        message: 'Driver not found.' }
  if (driver.id !== actorId)               return { error: 'FORBIDDEN',        message: 'You can only initiate a transfer for yourself.' }
  if (driver.status !== 'ACTIVE')          return { error: 'INVALID_STATUS',   message: 'Only active drivers can request a transfer.' }
  if (!toFleet || toFleet.status !== 'ACTIVE') return { error: 'INVALID_FLEET', message: 'Target fleet not found or not active.' }
  if (driver.fleetId === toFleetId)        return { error: 'SAME_FLEET',       message: 'You are already at this fleet.' }

  // Never allow transfer if driver has active loads (Section 22 rule)
  const activeLoad = await prisma.load.findFirst({
    where: { driverId, status: { in: ACTIVE_LOAD_STATUSES } }
  })
  if (activeLoad) return { error: 'HAS_ACTIVE_LOADS', message: 'Cannot initiate a transfer while you have active loads.' }

  const existing = await prisma.driverTransferRequest.findFirst({
    where: { driverId, status: { in: ['PENDING', 'PARTIAL'] } }
  })
  if (existing) return { error: 'TRANSFER_PENDING', message: 'A transfer request is already in progress.' }

  const now = new Date()

  const [transferRequest] = await prisma.$transaction([
    prisma.driverTransferRequest.create({
      data: { driverId, fromFleetId: driver.fleetId, toFleetId, status: 'PENDING' }
    }),
    prisma.driver.update({
      where: { id: driverId },
      data:  { status: 'SUSPENDED_TRANSFER', suspendedAt: now, suspendedReason: `Transfer to fleet ${toFleetId}` }
    })
  ])

  await sessionService.destroy(driverId)
  await prisma.session.updateMany({
    where: { userId: driverId, isActive: true },
    data:  { isActive: false }
  })

  await writeAuditLog({
    actorId,
    actorRole:   'DRIVER',
    actorEmail,
    actionType:  'TRANSFER_REQUEST',
    description: `Driver "${driver.name}" requested transfer from fleet ${driver.fleetId} to fleet ${toFleetId}.`,
    entityType:  'DriverTransferRequest',
    entityId:    transferRequest.id,
    newValue:    { fromFleetId: driver.fleetId, toFleetId },
    ipAddress
  })

  return { transferRequest }
}

// ─── Approve Driver Transfer ───────────────────────────────────
// Called by FLEET_ADMIN of either fromFleet or toFleet.
export async function approveDriverTransfer(requestId, { actorId, actorRole, actorEmail, ipAddress, fleetId }) {
  const request = await prisma.driverTransferRequest.findUnique({
    where:   { id: requestId },
    include: { driver: true }
  })

  if (!request) return { error: 'NOT_FOUND', message: 'Transfer request not found.' }
  if (!['PENDING', 'PARTIAL'].includes(request.status)) {
    return { error: 'INVALID_STATUS', message: `Cannot approve a transfer with status "${request.status}".` }
  }

  const isFromFleet = request.fromFleetId === fleetId
  const isToFleet   = request.toFleetId   === fleetId

  if (!isFromFleet && !isToFleet && actorRole !== 'SUPER_ADMIN') return { error: 'NOT_FOUND' }

  const updates = {}
  const now = new Date()

  if (actorRole === 'SUPER_ADMIN') {
    if (!request.fromFleetApprovedAt) updates.fromFleetApprovedAt = now
    if (!request.toFleetApprovedAt)   updates.toFleetApprovedAt   = now
  } else if (isFromFleet && !request.fromFleetApprovedAt) {
    updates.fromFleetApprovedAt = now
  } else if (isToFleet && !request.toFleetApprovedAt) {
    updates.toFleetApprovedAt = now
  } else {
    return { error: 'ALREADY_APPROVED_BY_FLEET', message: 'Your fleet has already approved this transfer.' }
  }

  const fromApproved = updates.fromFleetApprovedAt ?? request.fromFleetApprovedAt
  const toApproved   = updates.toFleetApprovedAt   ?? request.toFleetApprovedAt
  const bothApproved = !!(fromApproved && toApproved)

  if (bothApproved) {
    await prisma.$transaction(async (tx) => {
      await tx.driverTransferRequest.update({
        where: { id: requestId },
        data:  { ...updates, status: 'APPROVED' }
      })
      await tx.driver.update({
        where: { id: request.driverId },
        data:  { fleetId: request.toFleetId, status: 'ACTIVE', suspendedAt: null, suspendedReason: null }
      })
      await tx.driverFleetHistory.updateMany({
        where: { driverId: request.driverId, endedAt: null },
        data:  { endedAt: now, reason: 'TRANSFER' }
      })
      await tx.driverFleetHistory.create({
        data: { driverId: request.driverId, fleetId: request.toFleetId, startedAt: now, reason: 'TRANSFER' }
      })
    })
  } else {
    await prisma.driverTransferRequest.update({
      where: { id: requestId },
      data:  { ...updates, status: 'PARTIAL' }
    })
  }

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  bothApproved ? 'TRANSFER_APPROVED' : 'TRANSFER_PARTIAL_APPROVED',
    description: `Driver transfer ${requestId} ${bothApproved ? 'completed' : 'partially approved'} by fleet ${fleetId ?? 'SUPER_ADMIN'}.`,
    entityType:  'DriverTransferRequest',
    entityId:    requestId,
    ipAddress
  })

  return { success: true, completed: bothApproved }
}

// ─── Decline Driver Transfer ───────────────────────────────────
export async function declineDriverTransfer(requestId, { reason, actorId, actorRole, actorEmail, ipAddress, fleetId }) {
  const request = await prisma.driverTransferRequest.findUnique({
    where:   { id: requestId },
    include: { driver: true }
  })

  if (!request) return { error: 'NOT_FOUND', message: 'Transfer request not found.' }
  if (!['PENDING', 'PARTIAL'].includes(request.status)) {
    return { error: 'INVALID_STATUS', message: `Cannot decline a transfer with status "${request.status}".` }
  }

  const isFromFleet = request.fromFleetId === fleetId
  const isToFleet   = request.toFleetId   === fleetId
  if (!isFromFleet && !isToFleet && actorRole !== 'SUPER_ADMIN') return { error: 'NOT_FOUND' }

  await prisma.$transaction([
    prisma.driverTransferRequest.update({
      where: { id: requestId },
      data:  { status: 'DECLINED', declinedAt: new Date(), declinedByFleetId: fleetId, declineReason: reason ?? null }
    }),
    prisma.driver.update({
      where: { id: request.driverId },
      data:  { status: 'ACTIVE', suspendedAt: null, suspendedReason: null }
    })
  ])

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'TRANSFER_DECLINED',
    description: `Driver transfer ${requestId} declined by fleet ${fleetId ?? 'SUPER_ADMIN'}.`,
    entityType:  'DriverTransferRequest',
    entityId:    requestId,
    oldValue:    { status: request.status },
    newValue:    { status: 'DECLINED', declineReason: reason },
    ipAddress
  })

  return { success: true }
}

// ─── Cancel Driver Transfer ────────────────────────────────────
export async function cancelDriverTransfer(requestId, { actorId, actorRole, actorEmail, ipAddress }) {
  const request = await prisma.driverTransferRequest.findUnique({
    where:   { id: requestId },
    include: { driver: true }
  })

  if (!request) return { error: 'NOT_FOUND', message: 'Transfer request not found.' }
  if (request.driverId !== actorId) return { error: 'FORBIDDEN', message: 'You can only cancel your own transfer request.' }
  if (!['PENDING', 'PARTIAL'].includes(request.status)) {
    return { error: 'INVALID_STATUS', message: `Cannot cancel a transfer with status "${request.status}".` }
  }

  await prisma.$transaction([
    prisma.driverTransferRequest.update({
      where: { id: requestId },
      data:  { status: 'CANCELLED', cancelledAt: new Date() }
    }),
    prisma.driver.update({
      where: { id: request.driverId },
      data:  { status: 'ACTIVE', suspendedAt: null, suspendedReason: null }
    })
  ])

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'TRANSFER_CANCELLED',
    description: `Driver "${request.driver.name}" cancelled their transfer request.`,
    entityType:  'DriverTransferRequest',
    entityId:    requestId,
    ipAddress
  })

  return { success: true }
}

// ─── List Driver Transfer Requests ────────────────────────────
export async function listDriverTransfers({ page = 1, perPage = 20, status, isolation } = {}) {
  const skip  = (page - 1) * perPage
  const where = {}

  if (status) where.status = status

  if (isolation.role === 'FLEET_ADMIN') {
    where.OR = [{ fromFleetId: isolation.fleetId }, { toFleetId: isolation.fleetId }]
  } else if (isolation.role === 'DRIVER') {
    where.driverId = isolation.driverId
  }

  const [requests, total] = await Promise.all([
    prisma.driverTransferRequest.findMany({
      where,
      skip,
      take:    perPage,
      orderBy: { createdAt: 'desc' },
      include: {
        driver:    { select: { id: true, name: true, email: true } },
        fromFleet: { select: { id: true, name: true } },
        toFleet:   { select: { id: true, name: true } }
      }
    }),
    prisma.driverTransferRequest.count({ where })
  ])

  return { data: requests, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } }
}

// ──────────────────────────────────────────────────────────────
// JOIN REQUEST FLOW
// ──────────────────────────────────────────────────────────────

// ─── Initiate Join Request ─────────────────────────────────────
// Driver (INACTIVE) requests to join a new fleet.
export async function initiateDriverJoinRequest(driverId, { toFleetId, reason, actorId, actorEmail, ipAddress }) {
  const [driver, toFleet] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId } }),
    prisma.fleet.findUnique({ where: { id: toFleetId } })
  ])

  if (!driver)                              return { error: 'NOT_FOUND',       message: 'Driver not found.' }
  if (driver.id !== actorId)                return { error: 'FORBIDDEN',       message: 'You can only submit a join request for yourself.' }
  if (driver.status !== 'INACTIVE')         return { error: 'INVALID_STATUS',  message: 'Only inactive drivers can submit a join request.' }
  if (!toFleet || toFleet.status !== 'ACTIVE') return { error: 'INVALID_FLEET', message: 'Target fleet not found or not active.' }
  if (driver.fleetId === toFleetId)         return { error: 'SAME_FLEET',      message: 'You are already at this fleet.' }

  const existing = await prisma.driverJoinRequest.findFirst({
    where: { driverId, fleetId: toFleetId, status: 'PENDING' }
  })
  if (existing) return { error: 'REQUEST_PENDING', message: 'A join request to this fleet is already pending.' }

  const joinRequest = await prisma.driverJoinRequest.create({
    data: { driverId, fleetId: toFleetId, status: 'PENDING', reason: reason ?? null }
  })

  await writeAuditLog({
    actorId,
    actorRole:   'DRIVER',
    actorEmail,
    actionType:  'JOIN_REQUEST',
    description: `Driver "${driver.name}" requested to join fleet ${toFleetId}.`,
    entityType:  'DriverJoinRequest',
    entityId:    joinRequest.id,
    ipAddress
  })

  return { joinRequest }
}

// ─── Approve Driver Join Request ───────────────────────────────
export async function approveDriverJoinRequest(requestId, { actorId, actorRole, actorEmail, ipAddress, fleetId }) {
  const request = await prisma.driverJoinRequest.findUnique({
    where:   { id: requestId },
    include: { driver: true }
  })

  if (!request) return { error: 'NOT_FOUND', message: 'Join request not found.' }
  if (actorRole === 'FLEET_ADMIN' && request.fleetId !== fleetId) return { error: 'NOT_FOUND' }
  if (request.status !== 'PENDING') {
    return { error: 'INVALID_STATUS', message: `Cannot approve a join request with status "${request.status}".` }
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.driverJoinRequest.update({
      where: { id: requestId },
      data:  { status: 'APPROVED', reviewedAt: now, reviewedById: actorId }
    })
    await tx.driver.update({
      where: { id: request.driverId },
      data:  { fleetId: request.fleetId, status: 'ACTIVE', suspendedAt: null, suspendedReason: null }
    })
    await tx.driverFleetHistory.create({
      data: { driverId: request.driverId, fleetId: request.fleetId, startedAt: now, reason: 'JOIN' }
    })
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'JOIN_APPROVED',
    description: `Driver "${request.driver.name}" joined fleet ${request.fleetId}.`,
    entityType:  'DriverJoinRequest',
    entityId:    requestId,
    oldValue:    { status: request.status },
    newValue:    { status: 'APPROVED' },
    ipAddress
  })

  return { success: true }
}

// ─── Decline Driver Join Request ───────────────────────────────
export async function declineDriverJoinRequest(requestId, { reason, actorId, actorRole, actorEmail, ipAddress, fleetId }) {
  const request = await prisma.driverJoinRequest.findUnique({ where: { id: requestId } })

  if (!request) return { error: 'NOT_FOUND', message: 'Join request not found.' }
  if (actorRole === 'FLEET_ADMIN' && request.fleetId !== fleetId) return { error: 'NOT_FOUND' }
  if (request.status !== 'PENDING') {
    return { error: 'INVALID_STATUS', message: `Cannot decline a join request with status "${request.status}".` }
  }

  await prisma.driverJoinRequest.update({
    where: { id: requestId },
    data:  { status: 'DECLINED', reviewedAt: new Date(), reviewedById: actorId, declineReason: reason ?? null }
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'JOIN_DECLINED',
    description: `Driver join request ${requestId} declined.`,
    entityType:  'DriverJoinRequest',
    entityId:    requestId,
    oldValue:    { status: request.status },
    newValue:    { status: 'DECLINED', declineReason: reason },
    ipAddress
  })

  return { success: true }
}

// ─── Cancel Driver Join Request ────────────────────────────────
export async function cancelDriverJoinRequest(requestId, { actorId }) {
  const request = await prisma.driverJoinRequest.findUnique({ where: { id: requestId } })

  if (!request) return { error: 'NOT_FOUND', message: 'Join request not found.' }
  if (request.driverId !== actorId) return { error: 'FORBIDDEN', message: 'You can only cancel your own join request.' }
  if (request.status !== 'PENDING') {
    return { error: 'INVALID_STATUS', message: `Cannot cancel a join request with status "${request.status}".` }
  }

  await prisma.driverJoinRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED' } })

  return { success: true }
}

// ─── List Driver Join Requests ─────────────────────────────────
export async function listDriverJoinRequests({ page = 1, perPage = 20, status, isolation } = {}) {
  const skip  = (page - 1) * perPage
  const where = {}

  if (status) where.status = status

  if (isolation.role === 'FLEET_ADMIN') {
    where.fleetId = isolation.fleetId
  } else if (isolation.role === 'DRIVER') {
    where.driverId = isolation.driverId
  }

  const [requests, total] = await Promise.all([
    prisma.driverJoinRequest.findMany({
      where,
      skip,
      take:    perPage,
      orderBy: { createdAt: 'desc' },
      include: {
        driver: { select: { id: true, name: true, email: true, overallRating: true } }
      }
    }),
    prisma.driverJoinRequest.count({ where })
  ])

  return { data: requests, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } }
}
