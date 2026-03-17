import bcrypt from 'bcryptjs'
import { prisma } from './prisma.service.js'
import { sessionService } from './redis.service.js'
import { writeAuditLog } from '../middleware/audit.middleware.js'
import { checkDispatcherLimit } from './agency.service.js'
import {
  sendDispatcherWelcome,
  sendTransferRequest,
  sendTransferApproved,
  sendTransferDeclined
} from './email.service.js'

// Active load statuses — used to enforce "never transfer with active loads" rule
const ACTIVE_LOAD_STATUSES = ['ASSIGNED', 'IN_TRANSIT', 'PENDING_DELIVERY_CONFIRMATION']

// ─── Recalculate Dispatcher Rating ────────────────────────────
// Called after any rating create/remove. Uses tx for atomicity.
async function recalcRating(dispatcherId, tx = prisma) {
  const ratings = await tx.dispatcherRating.findMany({
    where:  { dispatcherId, removedBySuperAdmin: false },
    select: { overallRating: true }
  })

  const adminRatingAverage = ratings.length > 0
    ? ratings.reduce((sum, r) => sum + r.overallRating, 0) / ratings.length
    : 0

  const { autoScore } = await tx.dispatcher.findUnique({
    where:  { id: dispatcherId },
    select: { autoScore: true }
  })

  const overallRating = (autoScore * 0.60) + (adminRatingAverage * 0.40)

  await tx.dispatcher.update({
    where: { id: dispatcherId },
    data:  { adminRatingAverage, overallRating }
  })
}

// ─── Generate Temporary Password ──────────────────────────────
function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// ─── Create Dispatcher ─────────────────────────────────────────
export async function createDispatcher({ agencyId, name, email, phone, actorId, actorRole, actorEmail, ipAddress }) {
  // Enforce subscription plan dispatcher limit
  const limitCheck = await checkDispatcherLimit(agencyId)
  if (!limitCheck.allowed) return { error: 'LIMIT_REACHED', message: limitCheck.reason }

  const lower = email.toLowerCase().trim()

  const [agency, existing] = await Promise.all([
    prisma.agency.findUnique({ where: { id: agencyId } }),
    prisma.dispatcher.findUnique({ where: { email: lower } })
  ])

  if (!agency)   return { error: 'NOT_FOUND',    message: 'Agency not found.' }
  if (existing)  return { error: 'EMAIL_IN_USE', message: 'A dispatcher with this email already exists.' }

  const tempPassword = generateTempPassword()
  const hashed = await bcrypt.hash(tempPassword, 12)

  const dispatcher = await prisma.$transaction(async (tx) => {
    const d = await tx.dispatcher.create({
      data: {
        agencyId,
        name,
        email:             lower,
        password:          hashed,
        phone:             phone ?? null,
        status:            'ACTIVE',
        mustChangePassword: true
      }
    })

    // Record initial agency history entry
    await tx.dispatcherAgencyHistory.create({
      data: { dispatcherId: d.id, agencyId, startedAt: new Date(), reason: 'INITIAL' }
    })

    return d
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'CREATE',
    description: `Dispatcher "${name}" (${lower}) created.`,
    entityType:  'Dispatcher',
    entityId:    dispatcher.id,
    newValue:    { name, email: lower, agencyId },
    ipAddress,
    agencyId
  })

  const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`
  sendDispatcherWelcome({
    to: lower,
    dispatcherName: name,
    agencyName: agency.name,
    temporaryPassword: tempPassword,
    loginUrl
  }).catch(err => console.error('[email] sendDispatcherWelcome failed:', err.message))

  // Always log credentials to console as fallback in case email fails
  console.log(`[Dispatcher Created] ${lower} / temp password: ${tempPassword}`)

  return { dispatcher, temporaryPassword: tempPassword }
}

// ─── List Dispatchers ──────────────────────────────────────────
export async function listDispatchers({ page = 1, perPage = 20, status, isolation } = {}) {
  const skip  = (page - 1) * perPage
  const where = {}

  if (status) where.status = status

  if (isolation.role === 'AGENCY_ADMIN' || isolation.role === 'DISPATCHER') {
    where.agencyId = isolation.agencyId
  }
  // SUPER_ADMIN: no restriction

  const [dispatchers, total] = await Promise.all([
    prisma.dispatcher.findMany({
      where,
      skip,
      take:    perPage,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, agencyId: true, name: true, email: true, phone: true,
        status: true, totalLoadsCreated: true, totalLoadsCompleted: true,
        completionRate: true, onTimeDeliveryRate: true, overallRating: true,
        createdAt: true, updatedAt: true
      }
    }),
    prisma.dispatcher.count({ where })
  ])

  return {
    data: dispatchers,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) }
  }
}

// ─── Get Dispatcher By ID ──────────────────────────────────────
export async function getDispatcherById(dispatcherId, isolation) {
  const where = { id: dispatcherId }

  if (isolation.role === 'AGENCY_ADMIN') {
    where.agencyId = isolation.agencyId
  } else if (isolation.role === 'DISPATCHER') {
    if (isolation.dispatcherId !== dispatcherId) return null
  }

  return prisma.dispatcher.findFirst({
    where,
    include: {
      agency:         { select: { id: true, name: true } },
      agencyHistory:  { orderBy: { startedAt: 'desc' } },
      ratingsReceived: {
        where:   { removedBySuperAdmin: false },
        orderBy: { createdAt: 'desc' }
      }
    }
  })
}

// ─── Update Dispatcher Profile ─────────────────────────────────
export async function updateDispatcherProfile(dispatcherId, data, isolation) {
  if (isolation.role === 'DISPATCHER' && isolation.dispatcherId !== dispatcherId) return null

  if (isolation.role === 'AGENCY_ADMIN') {
    const d = await prisma.dispatcher.findUnique({ where: { id: dispatcherId } })
    if (!d || d.agencyId !== isolation.agencyId) return null
  }

  return prisma.dispatcher.update({ where: { id: dispatcherId }, data })
}

// ─── Deactivate Dispatcher ─────────────────────────────────────
export async function deactivateDispatcher(dispatcherId, { actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const dispatcher = await prisma.dispatcher.findUnique({ where: { id: dispatcherId } })

  if (!dispatcher) return { error: 'NOT_FOUND' }
  if (actorRole === 'AGENCY_ADMIN' && dispatcher.agencyId !== agencyId) return { error: 'NOT_FOUND' }
  if (dispatcher.status === 'INACTIVE') return { error: 'ALREADY_INACTIVE', message: 'Dispatcher is already inactive.' }

  const activeLoad = await prisma.load.findFirst({
    where: { dispatcherId, status: { in: ACTIVE_LOAD_STATUSES } }
  })
  if (activeLoad) return { error: 'HAS_ACTIVE_LOADS', message: 'Cannot deactivate a dispatcher with active loads.' }

  // Invalidate session
  await sessionService.destroy(dispatcherId)
  await prisma.session.updateMany({
    where: { userId: dispatcherId, isActive: true },
    data:  { isActive: false }
  })

  await prisma.$transaction(async (tx) => {
    await tx.dispatcher.update({
      where: { id: dispatcherId },
      data:  { status: 'INACTIVE' }
    })
    await tx.dispatcherAgencyHistory.updateMany({
      where: { dispatcherId, endedAt: null },
      data:  { endedAt: new Date() }
    })
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'DEACTIVATE',
    description: `Dispatcher "${dispatcher.name}" deactivated.`,
    entityType:  'Dispatcher',
    entityId:    dispatcherId,
    oldValue:    { status: dispatcher.status },
    newValue:    { status: 'INACTIVE' },
    ipAddress,
    agencyId:    dispatcher.agencyId
  })

  return { success: true }
}

// ─── Reactivate Dispatcher ─────────────────────────────────────
export async function reactivateDispatcher(dispatcherId, { actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const dispatcher = await prisma.dispatcher.findUnique({ where: { id: dispatcherId } })

  if (!dispatcher) return { error: 'NOT_FOUND' }
  if (actorRole === 'AGENCY_ADMIN' && dispatcher.agencyId !== agencyId) return { error: 'NOT_FOUND' }
  if (dispatcher.status === 'ACTIVE') return { error: 'ALREADY_ACTIVE', message: 'Dispatcher is already active.' }
  if (dispatcher.status !== 'INACTIVE') {
    return { error: 'INVALID_STATUS', message: `Cannot reactivate dispatcher with status "${dispatcher.status}".` }
  }

  const limitCheck = await checkDispatcherLimit(dispatcher.agencyId)
  if (!limitCheck.allowed) return { error: 'LIMIT_REACHED', message: limitCheck.reason }

  await prisma.$transaction(async (tx) => {
    await tx.dispatcher.update({ where: { id: dispatcherId }, data: { status: 'ACTIVE' } })
    await tx.dispatcherAgencyHistory.create({
      data: { dispatcherId, agencyId: dispatcher.agencyId, startedAt: new Date(), reason: 'REACTIVATION' }
    })
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'REACTIVATE',
    description: `Dispatcher "${dispatcher.name}" reactivated.`,
    entityType:  'Dispatcher',
    entityId:    dispatcherId,
    oldValue:    { status: dispatcher.status },
    newValue:    { status: 'ACTIVE' },
    ipAddress,
    agencyId:    dispatcher.agencyId
  })

  return { success: true }
}

// ──────────────────────────────────────────────────────────────
// TRANSFER FLOW
// ──────────────────────────────────────────────────────────────

// ─── Initiate Transfer ─────────────────────────────────────────
// Dispatcher requests to move to another agency.
// Both fromAgency and toAgency must approve.
export async function initiateTransfer(dispatcherId, { toAgencyId, actorId, actorEmail, ipAddress }) {
  const [dispatcher, toAgency] = await Promise.all([
    prisma.dispatcher.findUnique({ where: { id: dispatcherId } }),
    prisma.agency.findUnique({ where: { id: toAgencyId } })
  ])

  if (!dispatcher)                            return { error: 'NOT_FOUND',        message: 'Dispatcher not found.' }
  if (dispatcher.id !== actorId)              return { error: 'FORBIDDEN',        message: 'You can only initiate a transfer for yourself.' }
  if (dispatcher.status !== 'ACTIVE')         return { error: 'INVALID_STATUS',   message: 'Only active dispatchers can request a transfer.' }
  if (!toAgency || toAgency.status !== 'ACTIVE') return { error: 'INVALID_AGENCY', message: 'Target agency not found or not active.' }
  if (dispatcher.agencyId === toAgencyId)     return { error: 'SAME_AGENCY',      message: 'You are already at this agency.' }

  // Never allow transfer if dispatcher has active loads (Section 22 rule)
  const activeLoad = await prisma.load.findFirst({
    where: { dispatcherId, status: { in: ACTIVE_LOAD_STATUSES } }
  })
  if (activeLoad) return { error: 'HAS_ACTIVE_LOADS', message: 'Cannot initiate a transfer while you have active loads.' }

  const existing = await prisma.dispatcherTransferRequest.findFirst({
    where: { dispatcherId, status: { in: ['PENDING', 'PARTIAL'] } }
  })
  if (existing) return { error: 'TRANSFER_PENDING', message: 'A transfer request is already in progress.' }

  const now = new Date()

  const [transferRequest] = await prisma.$transaction([
    prisma.dispatcherTransferRequest.create({
      data: { dispatcherId, fromAgencyId: dispatcher.agencyId, toAgencyId, status: 'PENDING' }
    }),
    prisma.dispatcher.update({
      where: { id: dispatcherId },
      data:  { status: 'SUSPENDED_TRANSFER', suspendedAt: now, suspendedReason: `Transfer to agency ${toAgencyId}` }
    })
  ])

  // Invalidate session — dispatcher cannot work while transfer is pending
  await sessionService.destroy(dispatcherId)
  await prisma.session.updateMany({
    where: { userId: dispatcherId, isActive: true },
    data:  { isActive: false }
  })

  // Notify both agencies
  const fromAgency = await prisma.agency.findUnique({
    where:  { id: dispatcher.agencyId },
    select: { name: true, contactEmail: true }
  })

  await Promise.all([
    sendTransferRequest({
      to: fromAgency.contactEmail, adminName: fromAgency.name,
      dispatcherName: dispatcher.name, fromAgency: fromAgency.name, toAgency: toAgency.name
    }),
    sendTransferRequest({
      to: toAgency.contactEmail, adminName: toAgency.name,
      dispatcherName: dispatcher.name, fromAgency: fromAgency.name, toAgency: toAgency.name
    })
  ])

  await writeAuditLog({
    actorId,
    actorRole:   'DISPATCHER',
    actorEmail,
    actionType:  'TRANSFER_REQUEST',
    description: `Dispatcher "${dispatcher.name}" requested transfer from "${fromAgency.name}" to "${toAgency.name}".`,
    entityType:  'DispatcherTransferRequest',
    entityId:    transferRequest.id,
    newValue:    { fromAgencyId: dispatcher.agencyId, toAgencyId },
    ipAddress,
    agencyId:    dispatcher.agencyId
  })

  return { transferRequest }
}

// ─── Approve Transfer ──────────────────────────────────────────
// Called by AGENCY_ADMIN of either fromAgency or toAgency.
// Transfer completes when BOTH agencies have approved.
export async function approveTransfer(requestId, { actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const request = await prisma.dispatcherTransferRequest.findUnique({
    where:   { id: requestId },
    include: { dispatcher: true, fromAgency: true, toAgency: true }
  })

  if (!request) return { error: 'NOT_FOUND', message: 'Transfer request not found.' }
  if (!['PENDING', 'PARTIAL'].includes(request.status)) {
    return { error: 'INVALID_STATUS', message: `Cannot approve a transfer with status "${request.status}".` }
  }

  const isFromAgency = request.fromAgencyId === agencyId
  const isToAgency   = request.toAgencyId   === agencyId

  if (!isFromAgency && !isToAgency && actorRole !== 'SUPER_ADMIN') return { error: 'NOT_FOUND' }

  const updates = {}
  const now = new Date()

  if (actorRole === 'SUPER_ADMIN') {
    if (!request.fromAgencyApprovedAt) updates.fromAgencyApprovedAt = now
    if (!request.toAgencyApprovedAt)   updates.toAgencyApprovedAt   = now
  } else if (isFromAgency && !request.fromAgencyApprovedAt) {
    updates.fromAgencyApprovedAt = now
  } else if (isToAgency && !request.toAgencyApprovedAt) {
    updates.toAgencyApprovedAt = now
  } else {
    return { error: 'ALREADY_APPROVED_BY_AGENCY', message: 'Your agency has already approved this transfer.' }
  }

  const fromApproved = updates.fromAgencyApprovedAt ?? request.fromAgencyApprovedAt
  const toApproved   = updates.toAgencyApprovedAt   ?? request.toAgencyApprovedAt
  const bothApproved = !!(fromApproved && toApproved)

  if (bothApproved) {
    await prisma.$transaction(async (tx) => {
      await tx.dispatcherTransferRequest.update({
        where: { id: requestId },
        data:  { ...updates, status: 'APPROVED' }
      })
      await tx.dispatcher.update({
        where: { id: request.dispatcherId },
        data:  { agencyId: request.toAgencyId, status: 'ACTIVE', suspendedAt: null, suspendedReason: null }
      })
      // Close old history record, open new one
      await tx.dispatcherAgencyHistory.updateMany({
        where: { dispatcherId: request.dispatcherId, endedAt: null },
        data:  { endedAt: now, reason: 'TRANSFER' }
      })
      await tx.dispatcherAgencyHistory.create({
        data: { dispatcherId: request.dispatcherId, agencyId: request.toAgencyId, startedAt: now, reason: 'TRANSFER' }
      })
    })

    await sendTransferApproved({
      to: request.dispatcher.email,
      dispatcherName: request.dispatcher.name,
      toAgency: request.toAgency.name
    })
  } else {
    await prisma.dispatcherTransferRequest.update({
      where: { id: requestId },
      data:  { ...updates, status: 'PARTIAL' }
    })
  }

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  bothApproved ? 'TRANSFER_APPROVED' : 'TRANSFER_PARTIAL_APPROVED',
    description: `Transfer ${requestId} ${bothApproved ? 'completed' : 'partially approved'} by ${agencyId ?? 'SUPER_ADMIN'}.`,
    entityType:  'DispatcherTransferRequest',
    entityId:    requestId,
    ipAddress,
    agencyId
  })

  return { success: true, completed: bothApproved }
}

// ─── Decline Transfer ──────────────────────────────────────────
export async function declineTransfer(requestId, { reason, actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const request = await prisma.dispatcherTransferRequest.findUnique({
    where:   { id: requestId },
    include: { dispatcher: true }
  })

  if (!request) return { error: 'NOT_FOUND', message: 'Transfer request not found.' }
  if (!['PENDING', 'PARTIAL'].includes(request.status)) {
    return { error: 'INVALID_STATUS', message: `Cannot decline a transfer with status "${request.status}".` }
  }

  const isFromAgency = request.fromAgencyId === agencyId
  const isToAgency   = request.toAgencyId   === agencyId
  if (!isFromAgency && !isToAgency && actorRole !== 'SUPER_ADMIN') return { error: 'NOT_FOUND' }

  await prisma.$transaction([
    prisma.dispatcherTransferRequest.update({
      where: { id: requestId },
      data:  { status: 'DECLINED', declinedAt: new Date(), declinedByAgencyId: agencyId, declineReason: reason ?? null }
    }),
    // Restore dispatcher to ACTIVE at their original agency
    prisma.dispatcher.update({
      where: { id: request.dispatcherId },
      data:  { status: 'ACTIVE', suspendedAt: null, suspendedReason: null }
    })
  ])

  await sendTransferDeclined({
    to: request.dispatcher.email,
    dispatcherName: request.dispatcher.name,
    reason: reason ?? null
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'TRANSFER_DECLINED',
    description: `Transfer ${requestId} declined by ${agencyId ?? 'SUPER_ADMIN'}. ${reason ?? ''}`,
    entityType:  'DispatcherTransferRequest',
    entityId:    requestId,
    oldValue:    { status: request.status },
    newValue:    { status: 'DECLINED', declineReason: reason },
    ipAddress,
    agencyId
  })

  return { success: true }
}

// ─── Cancel Transfer ───────────────────────────────────────────
// Called by Dispatcher themselves.
export async function cancelTransfer(requestId, { actorId, actorRole, actorEmail, ipAddress }) {
  const request = await prisma.dispatcherTransferRequest.findUnique({
    where:   { id: requestId },
    include: { dispatcher: true }
  })

  if (!request) return { error: 'NOT_FOUND', message: 'Transfer request not found.' }
  if (request.dispatcherId !== actorId) return { error: 'FORBIDDEN', message: 'You can only cancel your own transfer request.' }
  if (!['PENDING', 'PARTIAL'].includes(request.status)) {
    return { error: 'INVALID_STATUS', message: `Cannot cancel a transfer with status "${request.status}".` }
  }

  await prisma.$transaction([
    prisma.dispatcherTransferRequest.update({
      where: { id: requestId },
      data:  { status: 'CANCELLED', cancelledAt: new Date() }
    }),
    prisma.dispatcher.update({
      where: { id: request.dispatcherId },
      data:  { status: 'ACTIVE', suspendedAt: null, suspendedReason: null }
    })
  ])

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'TRANSFER_CANCELLED',
    description: `Dispatcher "${request.dispatcher.name}" cancelled their transfer request.`,
    entityType:  'DispatcherTransferRequest',
    entityId:    requestId,
    ipAddress,
    agencyId:    request.fromAgencyId
  })

  return { success: true }
}

// ─── List Transfer Requests ────────────────────────────────────
export async function listTransferRequests({ page = 1, perPage = 20, status, isolation } = {}) {
  const skip  = (page - 1) * perPage
  const where = {}

  if (status) where.status = status

  if (isolation.role === 'AGENCY_ADMIN') {
    where.OR = [{ fromAgencyId: isolation.agencyId }, { toAgencyId: isolation.agencyId }]
  } else if (isolation.role === 'DISPATCHER') {
    where.dispatcherId = isolation.dispatcherId
  }

  const [requests, total] = await Promise.all([
    prisma.dispatcherTransferRequest.findMany({
      where,
      skip,
      take:    perPage,
      orderBy: { createdAt: 'desc' },
      include: {
        dispatcher: { select: { id: true, name: true, email: true } },
        fromAgency: { select: { id: true, name: true } },
        toAgency:   { select: { id: true, name: true } }
      }
    }),
    prisma.dispatcherTransferRequest.count({ where })
  ])

  return { data: requests, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } }
}

// ──────────────────────────────────────────────────────────────
// JOIN REQUEST FLOW
// ──────────────────────────────────────────────────────────────

// ─── Initiate Join Request ─────────────────────────────────────
// Dispatcher (INACTIVE) requests to join a new agency.
export async function initiateJoinRequest(dispatcherId, { toAgencyId, reason, actorId, actorEmail, ipAddress }) {
  const [dispatcher, toAgency] = await Promise.all([
    prisma.dispatcher.findUnique({ where: { id: dispatcherId } }),
    prisma.agency.findUnique({ where: { id: toAgencyId } })
  ])

  if (!dispatcher)                              return { error: 'NOT_FOUND',       message: 'Dispatcher not found.' }
  if (dispatcher.id !== actorId)                return { error: 'FORBIDDEN',       message: 'You can only submit a join request for yourself.' }
  if (dispatcher.status !== 'INACTIVE')         return { error: 'INVALID_STATUS',  message: 'Only inactive dispatchers can submit a join request.' }
  if (!toAgency || toAgency.status !== 'ACTIVE') return { error: 'INVALID_AGENCY', message: 'Target agency not found or not active.' }
  if (dispatcher.agencyId === toAgencyId)       return { error: 'SAME_AGENCY',     message: 'You are already at this agency.' }

  const existing = await prisma.dispatcherJoinRequest.findFirst({
    where: { dispatcherId, agencyId: toAgencyId, status: 'PENDING' }
  })
  if (existing) return { error: 'REQUEST_PENDING', message: 'A join request to this agency is already pending.' }

  const joinRequest = await prisma.dispatcherJoinRequest.create({
    data: { dispatcherId, agencyId: toAgencyId, status: 'PENDING', reason: reason ?? null }
  })

  await writeAuditLog({
    actorId,
    actorRole:   'DISPATCHER',
    actorEmail,
    actionType:  'JOIN_REQUEST',
    description: `Dispatcher "${dispatcher.name}" requested to join agency ${toAgencyId}.`,
    entityType:  'DispatcherJoinRequest',
    entityId:    joinRequest.id,
    ipAddress,
    agencyId:    toAgencyId
  })

  return { joinRequest }
}

// ─── Approve Join Request ──────────────────────────────────────
export async function approveJoinRequest(requestId, { actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const request = await prisma.dispatcherJoinRequest.findUnique({
    where:   { id: requestId },
    include: { dispatcher: true, agency: true }
  })

  if (!request) return { error: 'NOT_FOUND', message: 'Join request not found.' }
  if (actorRole === 'AGENCY_ADMIN' && request.agencyId !== agencyId) return { error: 'NOT_FOUND' }
  if (request.status !== 'PENDING') {
    return { error: 'INVALID_STATUS', message: `Cannot approve a join request with status "${request.status}".` }
  }

  const limitCheck = await checkDispatcherLimit(request.agencyId)
  if (!limitCheck.allowed) return { error: 'LIMIT_REACHED', message: limitCheck.reason }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.dispatcherJoinRequest.update({
      where: { id: requestId },
      data:  { status: 'APPROVED', reviewedAt: now, reviewedById: actorId }
    })
    await tx.dispatcher.update({
      where: { id: request.dispatcherId },
      data:  { agencyId: request.agencyId, status: 'ACTIVE', suspendedAt: null, suspendedReason: null }
    })
    await tx.dispatcherAgencyHistory.create({
      data: { dispatcherId: request.dispatcherId, agencyId: request.agencyId, startedAt: now, reason: 'JOIN' }
    })
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'JOIN_APPROVED',
    description: `Dispatcher "${request.dispatcher.name}" joined agency "${request.agency.name}".`,
    entityType:  'DispatcherJoinRequest',
    entityId:    requestId,
    oldValue:    { status: request.status },
    newValue:    { status: 'APPROVED' },
    ipAddress,
    agencyId:    request.agencyId
  })

  return { success: true }
}

// ─── Decline Join Request ──────────────────────────────────────
export async function declineJoinRequest(requestId, { reason, actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const request = await prisma.dispatcherJoinRequest.findUnique({
    where:   { id: requestId },
    include: { dispatcher: true }
  })

  if (!request) return { error: 'NOT_FOUND', message: 'Join request not found.' }
  if (actorRole === 'AGENCY_ADMIN' && request.agencyId !== agencyId) return { error: 'NOT_FOUND' }
  if (request.status !== 'PENDING') {
    return { error: 'INVALID_STATUS', message: `Cannot decline a join request with status "${request.status}".` }
  }

  await prisma.dispatcherJoinRequest.update({
    where: { id: requestId },
    data:  { status: 'DECLINED', reviewedAt: new Date(), reviewedById: actorId, declineReason: reason ?? null }
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'JOIN_DECLINED',
    description: `Join request ${requestId} declined.`,
    entityType:  'DispatcherJoinRequest',
    entityId:    requestId,
    oldValue:    { status: request.status },
    newValue:    { status: 'DECLINED', declineReason: reason },
    ipAddress,
    agencyId:    request.agencyId
  })

  return { success: true }
}

// ─── Cancel Join Request ───────────────────────────────────────
export async function cancelJoinRequest(requestId, { actorId }) {
  const request = await prisma.dispatcherJoinRequest.findUnique({ where: { id: requestId } })

  if (!request) return { error: 'NOT_FOUND', message: 'Join request not found.' }
  if (request.dispatcherId !== actorId) return { error: 'FORBIDDEN', message: 'You can only cancel your own join request.' }
  if (request.status !== 'PENDING') {
    return { error: 'INVALID_STATUS', message: `Cannot cancel a join request with status "${request.status}".` }
  }

  await prisma.dispatcherJoinRequest.update({
    where: { id: requestId },
    data:  { status: 'CANCELLED' }
  })

  return { success: true }
}

// ─── List Join Requests ────────────────────────────────────────
export async function listJoinRequests({ page = 1, perPage = 20, status, isolation } = {}) {
  const skip  = (page - 1) * perPage
  const where = {}

  if (status) where.status = status

  if (isolation.role === 'AGENCY_ADMIN') {
    where.agencyId = isolation.agencyId
  } else if (isolation.role === 'DISPATCHER') {
    where.dispatcherId = isolation.dispatcherId
  }

  const [requests, total] = await Promise.all([
    prisma.dispatcherJoinRequest.findMany({
      where,
      skip,
      take:    perPage,
      orderBy: { createdAt: 'desc' },
      include: {
        dispatcher: { select: { id: true, name: true, email: true, overallRating: true } },
        agency:     { select: { id: true, name: true } }
      }
    }),
    prisma.dispatcherJoinRequest.count({ where })
  ])

  return { data: requests, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } }
}

// ──────────────────────────────────────────────────────────────
// RATINGS
// ──────────────────────────────────────────────────────────────

// ─── Create Rating ─────────────────────────────────────────────
// Agency Admin rates a dispatcher. One rating per agency per dispatcher.
export async function createRating(dispatcherId, ratingData, { actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const dispatcher = await prisma.dispatcher.findUnique({ where: { id: dispatcherId } })
  if (!dispatcher) return { error: 'NOT_FOUND', message: 'Dispatcher not found.' }

  if (actorRole === 'AGENCY_ADMIN') {
    // Must have a current or historical relationship with this dispatcher
    const hasRelationship = dispatcher.agencyId === agencyId
      || !!(await prisma.dispatcherAgencyHistory.findFirst({ where: { dispatcherId, agencyId } }))

    if (!hasRelationship) return { error: 'NOT_FOUND', message: 'No agency relationship found for this dispatcher.' }
  }

  const rating = await prisma.$transaction(async (tx) => {
    const r = await tx.dispatcherRating.create({
      data: { dispatcherId, agencyId, ratedById: actorId, ...ratingData }
    })
    await recalcRating(dispatcherId, tx)
    return r
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'CREATE',
    description: `Rating submitted for dispatcher "${dispatcher.name}". Overall: ${ratingData.overallRating}/5.`,
    entityType:  'DispatcherRating',
    entityId:    rating.id,
    newValue:    ratingData,
    ipAddress,
    agencyId
  })

  return { rating }
}

// ─── Get Dispatcher Ratings ────────────────────────────────────
export async function getDispatcherRatings(dispatcherId, isolation) {
  const where = { id: dispatcherId }
  if (isolation.role === 'AGENCY_ADMIN') where.agencyId = isolation.agencyId
  else if (isolation.role === 'DISPATCHER' && isolation.dispatcherId !== dispatcherId) return null

  const dispatcher = await prisma.dispatcher.findFirst({ where })
  if (!dispatcher) return null

  return prisma.dispatcherRating.findMany({
    where:   { dispatcherId, removedBySuperAdmin: false },
    orderBy: { createdAt: 'desc' }
  })
}

// ─── Respond to Rating ─────────────────────────────────────────
// Dispatcher can respond once — response is not editable after submission.
export async function respondToRating(ratingId, { response, actorId }) {
  const rating = await prisma.dispatcherRating.findUnique({ where: { id: ratingId } })

  if (!rating)                    return { error: 'NOT_FOUND',          message: 'Rating not found.' }
  if (rating.dispatcherId !== actorId) return { error: 'FORBIDDEN',     message: 'You can only respond to ratings about yourself.' }
  if (rating.removedBySuperAdmin) return { error: 'RATING_REMOVED',     message: 'This rating has been removed.' }
  if (rating.dispatcherResponse)  return { error: 'ALREADY_RESPONDED',  message: 'You have already responded to this rating. Responses cannot be edited.' }

  await prisma.dispatcherRating.update({
    where: { id: ratingId },
    data:  { dispatcherResponse: response }
  })

  return { success: true }
}

// ─── Flag Rating ───────────────────────────────────────────────
// Dispatcher flags a rating they believe is unfair — Super Admin reviews.
export async function flagRating(ratingId, { reason, actorId }) {
  const rating = await prisma.dispatcherRating.findUnique({ where: { id: ratingId } })

  if (!rating)                    return { error: 'NOT_FOUND',       message: 'Rating not found.' }
  if (rating.dispatcherId !== actorId) return { error: 'FORBIDDEN',  message: 'You can only flag ratings about yourself.' }
  if (rating.isFlagged)           return { error: 'ALREADY_FLAGGED', message: 'This rating has already been flagged.' }
  if (rating.removedBySuperAdmin) return { error: 'RATING_REMOVED',  message: 'This rating has been removed.' }

  await prisma.dispatcherRating.update({
    where: { id: ratingId },
    data:  { isFlagged: true, flagReason: reason, flaggedAt: new Date() }
  })

  return { success: true }
}

// ─── Remove Rating (Super Admin only) ──────────────────────────
export async function removeRating(ratingId, { reason, actorId, actorEmail, ipAddress }) {
  const rating = await prisma.dispatcherRating.findUnique({ where: { id: ratingId } })

  if (!rating)                    return { error: 'NOT_FOUND',       message: 'Rating not found.' }
  if (rating.removedBySuperAdmin) return { error: 'ALREADY_REMOVED', message: 'Rating has already been removed.' }

  await prisma.$transaction(async (tx) => {
    await tx.dispatcherRating.update({
      where: { id: ratingId },
      data:  { removedBySuperAdmin: true, removedAt: new Date(), removedReason: reason ?? null }
    })
    await recalcRating(rating.dispatcherId, tx)
  })

  await writeAuditLog({
    actorId,
    actorRole:   'SUPER_ADMIN',
    actorEmail,
    actionType:  'REMOVE',
    description: `Rating ${ratingId} removed. Reason: ${reason ?? 'Not specified'}.`,
    entityType:  'DispatcherRating',
    entityId:    ratingId,
    ipAddress
  })

  return { success: true }
}
