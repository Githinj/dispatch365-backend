import { prisma } from './prisma.service.js'
import { sessionService } from './redis.service.js'
import { storageService } from './storage.service.js'
import { writeAuditLog } from '../middleware/audit.middleware.js'
import { sendAgencyCreated, sendAgencyAdminWelcome } from './email.service.js'
import { createNotification } from './notification.service.js'
import bcrypt from 'bcryptjs'

// ─── Create Agency (Super Admin) ─────────────────────────────
export async function createAgency(data, ctx) {
  // data: { name, ownerName, contactEmail, contactPhone, address, adminName, adminEmail, adminPassword, plan?, commissionPercent?, paymentTermsDays? }
  const existing = await prisma.agencyUser.findUnique({ where: { email: data.adminEmail } })
  if (existing) return { error: 'EMAIL_TAKEN', message: 'An account with this email already exists.' }

  const hash = await bcrypt.hash(data.adminPassword, 12)

  const agency = await prisma.$transaction(async (tx) => {
    const ag = await tx.agency.create({
      data: {
        name: data.name,
        ownerName: data.ownerName,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        address: data.address,
        plan: data.plan ?? 'BASIC',
        commissionPercent: data.commissionPercent ?? 8.0,
        paymentTermsDays: data.paymentTermsDays ?? 30,
      }
    })
    const adminUser = await tx.agencyUser.create({
      data: {
        agencyId: ag.id,
        name: data.adminName,
        email: data.adminEmail,
        password: hash,
        phone: data.adminPhone ?? null,
      }
    })
    return { agency: ag, adminUser }
  })

  await writeAuditLog({
    entityType: 'Agency',
    entityId: agency.agency.id,
    action: 'CREATE',
    actorId: ctx.actorId,
    actorRole: ctx.actorRole,
    agencyId: agency.agency.id,
    ipAddress: ctx.ipAddress,
    details: { name: data.name, plan: data.plan ?? 'BASIC' }
  })

  const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`

  // Email 1 — notify the agency contact/owner that their agency is live
  sendAgencyCreated({
    to:         data.contactEmail,
    ownerName:  data.ownerName,
    agencyName: data.name,
    plan:       data.plan ?? 'BASIC',
  }).catch(err => console.error('[email] sendAgencyCreated failed:', err.message))

  // Email 2 — send credentials to the agency admin user
  sendAgencyAdminWelcome({
    to:                data.adminEmail,
    adminName:         data.adminName,
    agencyName:        data.name,
    temporaryPassword: data.adminPassword,
    loginUrl,
  }).catch(err => console.error('[email] sendAgencyAdminWelcome failed:', err.message))

  // In-app notification for the admin user
  createNotification({
    userId:   agency.adminUser.id,
    userRole: 'AGENCY_ADMIN',
    agencyId: agency.agency.id,
    type:     'AGENCY_CREATED',
    title:    'Welcome to Dispatch 365',
    message:  `Your agency "${data.name}" has been set up. Log in to get started.`,
  }).catch(err => console.error('[notification] createNotification failed:', err.message))

  return { agency: agency.agency, adminUser: { id: agency.adminUser.id, email: agency.adminUser.email, name: agency.adminUser.name } }
}

// Dispatcher limits per subscription plan (-1 = unlimited)
export const PLAN_LIMITS = {
  BASIC:      5,
  PRO:        15,
  ENTERPRISE: -1
}

// ─── Get All Agencies (Super Admin) ─────────────────────────
export async function getAllAgencies({ page = 1, perPage = 20, status } = {}) {
  const where = status ? { status } : {}
  const skip  = (page - 1) * perPage

  const [agencies, total] = await Promise.all([
    prisma.agency.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { dispatchers: true, loads: true } }
      }
    }),
    prisma.agency.count({ where })
  ])

  return {
    data: agencies,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) }
  }
}

// ─── Get Single Agency ───────────────────────────────────────
export async function getAgencyById(id) {
  return prisma.agency.findUnique({
    where: { id },
    include: {
      agencyUsers: { select: { id: true, name: true, email: true } },
      _count: { select: { dispatchers: true, loads: true } }
    }
  })
}

// ─── Update Agency Settings ──────────────────────────────────
// Agency Admin can update their own settings (not plan, not status)
// Super Admin can update anything including plan
export async function updateAgency(id, data, actorRole) {
  // Fields only Super Admin can change
  if (actorRole !== 'SUPER_ADMIN') {
    delete data.plan
    delete data.status
    delete data.subscriptionExpiresAt
    delete data.commissionPercent // Only SA can change platform-level commission defaults
  }

  const old = await prisma.agency.findUnique({ where: { id } })
  if (!old) return null

  const updated = await prisma.agency.update({ where: { id }, data })
  return { old, updated }
}

// ─── Update Agency Branding ──────────────────────────────────
export async function updateAgencyBranding(id, brandingData, logoFile) {
  let logoUrl = brandingData.logoUrl // keep existing if no new file

  if (logoFile) {
    // Upload to Supabase Storage — agency-logos bucket (PUBLIC)
    // getPublicUrl() is used (not signed URL) since bucket is public
    const path = await storageService.uploadAgencyLogo(logoFile, id)
    logoUrl = storageService.getPublicUrl(process.env.STORAGE_BUCKET_LOGOS, path)
  }

  const updated = await prisma.agency.update({
    where: { id },
    data: {
      ...(logoUrl             !== undefined && { logoUrl }),
      ...(brandingData.primaryColor      && { primaryColor:      brandingData.primaryColor }),
      ...(brandingData.secondaryColor    && { secondaryColor:    brandingData.secondaryColor }),
      ...(brandingData.agencyAddress     && { agencyAddress:     brandingData.agencyAddress }),
      ...(brandingData.agencyPhone       && { agencyPhone:       brandingData.agencyPhone }),
      ...(brandingData.agencyEmail       && { agencyEmail:       brandingData.agencyEmail }),
      ...(brandingData.footerText        && { footerText:        brandingData.footerText }),
      ...(brandingData.customEmailDomain && { customEmailDomain: brandingData.customEmailDomain })
    }
  })

  return updated
}

// ─── Suspend Agency ──────────────────────────────────────────
// 1. Set agency.status = SUSPENDED
// 2. Invalidate ALL sessions for every user under the agency
// 3. Freeze DRAFT + ASSIGNED loads (block progression via business logic)
export async function suspendAgency(id, { reason, actorId, actorEmail, ipAddress }) {
  const agency = await prisma.agency.findUnique({ where: { id } })
  if (!agency) return null
  if (agency.status === 'SUSPENDED') return { alreadySuspended: true }

  // 1. Suspend the agency
  await prisma.agency.update({
    where: { id },
    data:  { status: 'SUSPENDED' }
  })

  // 2. Collect all user IDs under this agency
  const [agencyUsers, dispatchers] = await Promise.all([
    prisma.agencyUser.findMany({ where: { agencyId: id }, select: { id: true } }),
    prisma.dispatcher.findMany({ where: { agencyId: id }, select: { id: true } })
  ])

  const allUserIds = [
    ...agencyUsers.map(u => u.id),
    ...dispatchers.map(u => u.id)
  ]

  // 3. Invalidate Redis sessions for all users (immediate logout)
  await Promise.all(allUserIds.map(uid => sessionService.destroy(uid)))

  // 4. Mark DB sessions as inactive
  await prisma.session.updateMany({
    where: { userId: { in: allUserIds }, isActive: true },
    data:  { isActive: false }
  })

  // 5. Log audit
  await writeAuditLog({
    actorId,
    actorRole: 'SUPER_ADMIN',
    actorEmail,
    actionType: 'SUSPEND',
    description: `Agency "${agency.name}" suspended. Reason: ${reason ?? 'Not specified'}. ${allUserIds.length} sessions invalidated.`,
    entityType: 'Agency',
    entityId: id,
    oldValue: { status: agency.status },
    newValue: { status: 'SUSPENDED' },
    ipAddress
  })

  return { agency, sessionsInvalidated: allUserIds.length }
}

// ─── Reactivate Agency ───────────────────────────────────────
export async function reactivateAgency(id, { actorId, actorEmail, ipAddress }) {
  const agency = await prisma.agency.findUnique({ where: { id } })
  if (!agency) return null
  if (agency.status === 'ACTIVE') return { alreadyActive: true }

  const updated = await prisma.agency.update({
    where: { id },
    data:  { status: 'ACTIVE' }
  })

  await writeAuditLog({
    actorId,
    actorRole: 'SUPER_ADMIN',
    actorEmail,
    actionType: 'REACTIVATE',
    description: `Agency "${agency.name}" reactivated.`,
    entityType: 'Agency',
    entityId: id,
    oldValue: { status: agency.status },
    newValue: { status: 'ACTIVE' },
    ipAddress
  })

  return updated
}

// ─── Check Dispatcher Limit ──────────────────────────────────
// Used by Dispatcher module before adding/inviting a new dispatcher
export async function checkDispatcherLimit(agencyId) {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { plan: true }
  })
  if (!agency) return { allowed: false, reason: 'Agency not found.' }

  const limit = PLAN_LIMITS[agency.plan]
  if (limit === -1) return { allowed: true } // ENTERPRISE = unlimited

  const current = await prisma.dispatcher.count({
    where: { agencyId, status: { not: 'INACTIVE' } }
  })

  if (current >= limit) {
    return {
      allowed: false,
      reason: `Your ${agency.plan} plan allows a maximum of ${limit} dispatchers. Upgrade to add more.`
    }
  }

  return { allowed: true }
}
