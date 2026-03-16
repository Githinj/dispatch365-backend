import bcrypt from 'bcryptjs'
import { v4 as uuid } from 'uuid'
import { prisma } from './prisma.service.js'
import { storageService } from './storage.service.js'
import { sessionService } from './redis.service.js'
import { writeAuditLog } from '../middleware/audit.middleware.js'
import {
  sendFleetInvite,
  sendFleetApproved,
  sendFleetRejected
} from './email.service.js'

const REGISTRATION_TOKEN_TTL_HOURS = 48

// ─── Invite Fleet ──────────────────────────────────────────────
// Agency Admin creates an invite — fleet gets INVITED status + one-time registration link
export async function inviteFleet({ agencyId, fleetName, adminName, email, actorId, actorRole, actorEmail, ipAddress }) {
  const lower = email.toLowerCase().trim()

  const [agency, existing] = await Promise.all([
    prisma.agency.findUnique({ where: { id: agencyId }, select: { id: true, name: true } }),
    prisma.fleet.findUnique({ where: { email: lower } })
  ])

  if (!agency) return { error: 'NOT_FOUND', message: 'Agency not found.' }
  if (existing) return { error: 'EMAIL_IN_USE', message: 'A fleet with this email already exists.' }

  const token  = uuid()
  const expiry = new Date(Date.now() + REGISTRATION_TOKEN_TTL_HOURS * 60 * 60 * 1000)

  const fleet = await prisma.fleet.create({
    data: {
      name:                    fleetName,
      adminName,
      email:                   lower,
      phone:                   '', // provided during registration
      invitedByAgencyId:       agencyId,
      status:                  'INVITED',
      registrationToken:       token,
      registrationTokenExpiry: expiry
    }
  })

  const registrationUrl = `${process.env.FRONTEND_URL}/register/fleet/${token}`
  await sendFleetInvite({ to: lower, adminName, agencyName: agency.name, registrationUrl })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'INVITE',
    description: `Fleet invitation sent to "${fleetName}" (${lower}).`,
    entityType:  'Fleet',
    entityId:    fleet.id,
    newValue:    { fleetName, adminName, email: lower },
    ipAddress,
    agencyId
  })

  return { fleet }
}

// ─── Validate Registration Token ───────────────────────────────
export async function validateRegistrationToken(token) {
  const fleet = await prisma.fleet.findUnique({ where: { registrationToken: token } })

  if (!fleet) return { error: 'INVALID_TOKEN', message: 'Invalid registration link.' }
  if (fleet.status !== 'INVITED') return { error: 'TOKEN_USED', message: 'This registration link has already been used.' }
  if (fleet.registrationTokenExpiry < new Date()) {
    return { error: 'TOKEN_EXPIRED', message: 'This registration link has expired. Please ask the agency to resend the invitation.' }
  }

  // Fetch agency name for display
  let agencyName = null
  if (fleet.invitedByAgencyId) {
    const agency = await prisma.agency.findUnique({
      where:  { id: fleet.invitedByAgencyId },
      select: { name: true }
    })
    agencyName = agency?.name ?? null
  }

  return {
    fleet: {
      id:         fleet.id,
      name:       fleet.name,
      adminName:  fleet.adminName,
      email:      fleet.email,
      agencyName
    }
  }
}

// ─── Register Fleet ────────────────────────────────────────────
// Public — no auth. Fleet admin submits company details + documents.
export async function registerFleet(token, { name, adminName, phone, address, contactPerson, password }, files) {
  const found = await validateRegistrationToken(token)
  if (found.error) return found

  const fleet  = await prisma.fleet.findUnique({ where: { registrationToken: token } })
  const hashed = await bcrypt.hash(password, 12)

  // Upload documents to Supabase Storage (all optional at registration time)
  const docUploads = []
  const docTypes   = ['businessCert', 'operatingLicense', 'insuranceCert']

  for (const docType of docTypes) {
    const file = files?.[docType]?.[0]
    if (file) {
      const storagePath = await storageService.uploadFleetDocument(file, fleet.id, docType)
      docUploads.push({
        fleetId:      fleet.id,
        documentType: docType,
        storagePath,
        fileName:     file.originalname,
        mimeType:     file.mimetype
      })
    }
  }

  // Atomic: update fleet + create FleetAdmin + save documents
  const result = await prisma.$transaction(async (tx) => {
    const updatedFleet = await tx.fleet.update({
      where: { id: fleet.id },
      data: {
        name,
        adminName,
        phone,
        ...(address       && { address }),
        ...(contactPerson && { contactPerson }),
        status:                  'PENDING',
        registrationToken:       null,
        registrationTokenExpiry: null
      }
    })

    const fleetAdmin = await tx.fleetAdmin.create({
      data: {
        fleetId:  fleet.id,
        name:     adminName,
        email:    fleet.email,
        password: hashed,
        phone
      }
    })

    if (docUploads.length > 0) {
      await tx.fleetDocument.createMany({ data: docUploads })
    }

    return { fleet: updatedFleet, fleetAdmin }
  })

  return { fleet: result.fleet }
}

// ─── Approve Fleet ─────────────────────────────────────────────
export async function approveFleet(fleetId, { actorId, actorRole, actorEmail, ipAddress, agencyId, commissionOverride }) {
  const fleet = await prisma.fleet.findUnique({
    where:   { id: fleetId },
    include: { fleetAdmin: { select: { id: true } } }
  })

  if (!fleet) return { error: 'NOT_FOUND', message: 'Fleet not found.' }
  if (fleet.status !== 'PENDING') {
    return { error: 'INVALID_STATUS', message: `Cannot approve a fleet with status "${fleet.status}".` }
  }

  const resolvedAgencyId = fleet.invitedByAgencyId ?? agencyId
  if (!resolvedAgencyId) return { error: 'NO_AGENCY', message: 'Cannot determine agency for this fleet.' }

  const agency = await prisma.agency.findUnique({
    where:  { id: resolvedAgencyId },
    select: { id: true, name: true, commissionPercent: true }
  })
  if (!agency) return { error: 'NOT_FOUND', message: 'Agency not found.' }

  const commission = commissionOverride ?? agency.commissionPercent

  await prisma.$transaction(async (tx) => {
    await tx.fleet.update({
      where: { id: fleetId },
      data:  { status: 'ACTIVE', approvedAt: new Date() }
    })

    await tx.agencyFleetRelationship.upsert({
      where:  { agencyId_fleetId: { agencyId: resolvedAgencyId, fleetId } },
      update: { status: 'ACTIVE', commissionPercent: commission },
      create: { agencyId: resolvedAgencyId, fleetId, commissionPercent: commission, status: 'ACTIVE' }
    })
  })

  await sendFleetApproved({ to: fleet.email, adminName: fleet.adminName, agencyName: agency.name })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'APPROVE',
    description: `Fleet "${fleet.name}" approved. Commission: ${commission}%.`,
    entityType:  'Fleet',
    entityId:    fleetId,
    oldValue:    { status: fleet.status },
    newValue:    { status: 'ACTIVE', agencyId: resolvedAgencyId, commissionPercent: commission },
    ipAddress,
    agencyId:    resolvedAgencyId
  })

  return { success: true }
}

// ─── Reject Fleet ──────────────────────────────────────────────
export async function rejectFleet(fleetId, { reason, actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId } })

  if (!fleet) return { error: 'NOT_FOUND', message: 'Fleet not found.' }
  if (fleet.status !== 'PENDING') {
    return { error: 'INVALID_STATUS', message: `Cannot reject a fleet with status "${fleet.status}".` }
  }

  await prisma.fleet.update({
    where: { id: fleetId },
    data:  { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: reason }
  })

  await sendFleetRejected({ to: fleet.email, adminName: fleet.adminName, reason })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'REJECT',
    description: `Fleet "${fleet.name}" rejected. Reason: ${reason}.`,
    entityType:  'Fleet',
    entityId:    fleetId,
    oldValue:    { status: fleet.status },
    newValue:    { status: 'REJECTED', rejectionReason: reason },
    ipAddress,
    agencyId:    fleet.invitedByAgencyId ?? agencyId
  })

  return { success: true }
}

// ─── Suspend Fleet ─────────────────────────────────────────────
export async function suspendFleet(fleetId, { reason, actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const fleet = await prisma.fleet.findUnique({
    where:   { id: fleetId },
    include: { fleetAdmin: { select: { id: true } } }
  })

  if (!fleet) return { error: 'NOT_FOUND', message: 'Fleet not found.' }
  if (fleet.status === 'SUSPENDED') return { error: 'ALREADY_SUSPENDED', message: 'Fleet is already suspended.' }
  if (fleet.status !== 'ACTIVE') {
    return { error: 'INVALID_STATUS', message: `Cannot suspend a fleet with status "${fleet.status}".` }
  }

  await prisma.fleet.update({ where: { id: fleetId }, data: { status: 'SUSPENDED' } })

  // Invalidate fleet admin session
  if (fleet.fleetAdmin) {
    await sessionService.destroy(fleet.fleetAdmin.id)
    await prisma.session.updateMany({
      where: { userId: fleet.fleetAdmin.id, isActive: true },
      data:  { isActive: false }
    })
  }

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'SUSPEND',
    description: `Fleet "${fleet.name}" suspended. Reason: ${reason ?? 'Not specified'}.`,
    entityType:  'Fleet',
    entityId:    fleetId,
    oldValue:    { status: fleet.status },
    newValue:    { status: 'SUSPENDED' },
    ipAddress,
    agencyId:    fleet.invitedByAgencyId ?? agencyId
  })

  return { success: true }
}

// ─── Reactivate Fleet ──────────────────────────────────────────
export async function reactivateFleet(fleetId, { actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId } })

  if (!fleet) return { error: 'NOT_FOUND', message: 'Fleet not found.' }
  if (fleet.status === 'ACTIVE') return { error: 'ALREADY_ACTIVE', message: 'Fleet is already active.' }
  if (fleet.status !== 'SUSPENDED') {
    return { error: 'INVALID_STATUS', message: `Cannot reactivate a fleet with status "${fleet.status}".` }
  }

  await prisma.fleet.update({ where: { id: fleetId }, data: { status: 'ACTIVE' } })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'REACTIVATE',
    description: `Fleet "${fleet.name}" reactivated.`,
    entityType:  'Fleet',
    entityId:    fleetId,
    oldValue:    { status: fleet.status },
    newValue:    { status: 'ACTIVE' },
    ipAddress,
    agencyId:    fleet.invitedByAgencyId ?? agencyId
  })

  return { success: true }
}

// ─── List Fleets ───────────────────────────────────────────────
export async function listFleets({ page = 1, perPage = 20, status, isolation } = {}) {
  const skip  = (page - 1) * perPage
  const where = {}

  if (status) where.status = status

  if (isolation.role === 'AGENCY_ADMIN') {
    where.invitedByAgencyId = isolation.agencyId
  } else if (isolation.role === 'FLEET_ADMIN') {
    where.id = isolation.fleetId
  }
  // SUPER_ADMIN: no restriction

  const [fleets, total] = await Promise.all([
    prisma.fleet.findMany({
      where,
      skip,
      take:     perPage,
      orderBy:  { createdAt: 'desc' },
      include: {
        _count:                  { select: { drivers: true, vehicles: true, loads: true } },
        agencyFleetRelationships: {
          where:  { status: 'ACTIVE' },
          select: { agencyId: true, commissionPercent: true }
        }
      }
    }),
    prisma.fleet.count({ where })
  ])

  return {
    data: fleets,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) }
  }
}

// ─── Get Fleet By ID ───────────────────────────────────────────
export async function getFleetById(fleetId, isolation) {
  const where = { id: fleetId }

  if (isolation.role === 'AGENCY_ADMIN') {
    where.invitedByAgencyId = isolation.agencyId
  } else if (isolation.role === 'FLEET_ADMIN') {
    // Fleet admin can only access their own fleet
    if (isolation.fleetId !== fleetId) return null
  }

  return prisma.fleet.findFirst({
    where,
    include: {
      fleetDocuments:           true,
      agencyFleetRelationships: {
        where:   { status: 'ACTIVE' },
        include: { agency: { select: { id: true, name: true } } }
      },
      _count: { select: { drivers: true, vehicles: true, loads: true } }
    }
  })
}

// ─── Get Fleet Documents (with signed URLs) ────────────────────
export async function getFleetDocuments(fleetId) {
  const docs = await prisma.fleetDocument.findMany({
    where:   { fleetId },
    orderBy: { uploadedAt: 'desc' }
  })

  const docsWithUrls = await Promise.all(
    docs.map(async (doc) => {
      const signedUrl = await storageService.getSignedUrl(
        process.env.STORAGE_BUCKET_DOCUMENTS,
        doc.storagePath
      )
      return { ...doc, signedUrl }
    })
  )

  return docsWithUrls
}

// ─── Upload Fleet Document ─────────────────────────────────────
export async function uploadFleetDocument(fleetId, file, documentType, { actorId, actorEmail, ipAddress }) {
  const storagePath = await storageService.uploadFleetDocument(file, fleetId, documentType)

  const doc = await prisma.fleetDocument.create({
    data: {
      fleetId,
      documentType,
      storagePath,
      fileName: file.originalname,
      mimeType: file.mimetype
    }
  })

  await writeAuditLog({
    actorId,
    actorRole:   'FLEET_ADMIN',
    actorEmail,
    actionType:  'UPLOAD',
    description: `Fleet document uploaded: ${documentType} (${file.originalname}).`,
    entityType:  'FleetDocument',
    entityId:    doc.id,
    newValue:    { documentType, fileName: file.originalname },
    ipAddress
  })

  return doc
}

// ─── Update Fleet ──────────────────────────────────────────────
// FLEET_ADMIN: update their own fleet profile fields
export async function updateFleet(fleetId, data) {
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId } })
  if (!fleet) return null

  return prisma.fleet.update({ where: { id: fleetId }, data })
}

// ─── Update Fleet Relationship Commission ──────────────────────
// AGENCY_ADMIN: adjust per-fleet commission percent after approval
export async function updateFleetRelationship(agencyId, fleetId, { commissionPercent }) {
  const rel = await prisma.agencyFleetRelationship.findUnique({
    where: { agencyId_fleetId: { agencyId, fleetId } }
  })
  if (!rel) return null

  return prisma.agencyFleetRelationship.update({
    where: { agencyId_fleetId: { agencyId, fleetId } },
    data:  { commissionPercent }
  })
}

// ─── Resend Invite ─────────────────────────────────────────────
export async function resendInvite(fleetId, { actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId } })

  if (!fleet) return { error: 'NOT_FOUND', message: 'Fleet not found.' }
  if (fleet.status !== 'INVITED') {
    return { error: 'INVALID_STATUS', message: 'Can only resend invite for fleets with INVITED status.' }
  }

  const token  = uuid()
  const expiry = new Date(Date.now() + REGISTRATION_TOKEN_TTL_HOURS * 60 * 60 * 1000)

  await prisma.fleet.update({
    where: { id: fleetId },
    data:  { registrationToken: token, registrationTokenExpiry: expiry }
  })

  const resolvedAgencyId = fleet.invitedByAgencyId ?? agencyId
  const agency = resolvedAgencyId
    ? await prisma.agency.findUnique({ where: { id: resolvedAgencyId }, select: { name: true } })
    : null

  const registrationUrl = `${process.env.FRONTEND_URL}/register/fleet/${token}`
  await sendFleetInvite({ to: fleet.email, adminName: fleet.adminName, agencyName: agency?.name ?? '', registrationUrl })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'RESEND_INVITE',
    description: `Fleet invitation resent to "${fleet.name}" (${fleet.email}).`,
    entityType:  'Fleet',
    entityId:    fleetId,
    ipAddress,
    agencyId:    resolvedAgencyId
  })

  return { success: true }
}
