import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from './prisma.service.js'
import { sessionService } from './redis.service.js'

const JWT_SECRET     = process.env.JWT_SECRET
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d'

// ─── Role → Table Map ────────────────────────────────────────
// Maps UserRole enum to the Prisma model that holds that user
const ROLE_MODEL = {
  SUPER_ADMIN:  'superAdmin',
  AGENCY_ADMIN: 'agencyUser',
  DISPATCHER:   'dispatcher',
  FLEET_ADMIN:  'fleetAdmin',
  DRIVER:       'driver'
}

// ─── Find User By Email (searches all role tables) ──────────
export async function findUserByEmail(email) {
  const lower = email.toLowerCase().trim()

  const [superAdmin, agencyUser, dispatcher, fleetAdmin, driver] = await Promise.all([
    prisma.superAdmin.findUnique({ where: { email: lower } }),
    prisma.agencyUser.findUnique({ where: { email: lower } }),
    prisma.dispatcher.findUnique({ where: { email: lower } }),
    prisma.fleetAdmin.findUnique({ where: { email: lower } }),
    prisma.driver.findUnique({ where: { email: lower } })
  ])

  if (superAdmin)  return { user: superAdmin, role: 'SUPER_ADMIN' }
  if (agencyUser)  return { user: agencyUser, role: 'AGENCY_ADMIN' }
  if (dispatcher)  return { user: dispatcher, role: 'DISPATCHER' }
  if (fleetAdmin)  return { user: fleetAdmin, role: 'FLEET_ADMIN' }
  if (driver)      return { user: driver,     role: 'DRIVER' }

  return null
}

// ─── Generate JWT ────────────────────────────────────────────
export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

// ─── Verify JWT ──────────────────────────────────────────────
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET) // throws if invalid/expired
}

// ─── Login ───────────────────────────────────────────────────
export async function login({ email, password, isMobile = false, ipAddress, deviceInfo }) {
  const lower = email.toLowerCase().trim()

  // 1. Check account lockout (Redis)
  const locked = await sessionService.isLocked(lower)
  if (locked) {
    return { error: 'ACCOUNT_LOCKED', message: 'Account temporarily locked due to too many failed login attempts. Try again in 15 minutes.' }
  }

  // 2. Find user across all role tables
  const found = await findUserByEmail(lower)
  if (!found) {
    await handleFailedAttempt(lower)
    return { error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
  }

  const { user, role } = found

  // 3. Verify password
  const valid = await bcrypt.compare(password, user.password)
  if (!valid) {
    await handleFailedAttempt(lower)
    return { error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
  }

  // 4. Check account status (not applicable to SUPER_ADMIN)
  if (role !== 'SUPER_ADMIN') {
    const statusCheck = checkUserStatus(user, role)
    if (statusCheck) return statusCheck
  }

  // 5. Clear failed attempt counter on success
  await sessionService.clearFailedAttempts(lower)

  // 6. Build JWT payload
  const payload = {
    sub:   user.id,
    role,
    email: user.email,
    // Include agencyId or fleetId in token for fast isolation
    ...(user.agencyId && { agencyId: user.agencyId }),
    ...(user.fleetId  && { fleetId:  user.fleetId  })
  }

  // 7. Check if driver is IN_TRANSIT (extends mobile session to 24h)
  let isDriverInTransit = false
  if (role === 'DRIVER') {
    const activeLoad = await prisma.load.findFirst({
      where: { driverId: user.id, status: 'IN_TRANSIT' }
    })
    isDriverInTransit = !!activeLoad
  }

  // 8. Generate token — this invalidates any existing session (single session enforcement)
  const token = generateToken(payload)
  const ttl = await sessionService.set(user.id, token, { isMobile, isDriverInTransit })

  // 9. Upsert session record in DB
  await prisma.session.updateMany({
    where: { userId: user.id, isActive: true },
    data:  { isActive: false }
  })

  const sessionData = {
    userId:    user.id,
    userRole:  role,
    token,
    isActive:  true,
    ipAddress,
    deviceInfo,
    expiresAt: new Date(Date.now() + ttl * 1000),
    // Set the appropriate FK based on role
    agencyUserId: role === 'AGENCY_ADMIN' ? user.id : null,
    dispatcherId: role === 'DISPATCHER'   ? user.id : null,
    fleetAdminId: role === 'FLEET_ADMIN'  ? user.id : null,
    driverId:     role === 'DRIVER'       ? user.id : null
  }
  await prisma.session.create({ data: sessionData })

  // 10. Return token + safe user object
  return { token, user: sanitizeUser(user, role), role }
}

// ─── Logout ──────────────────────────────────────────────────
export async function logout(userId) {
  await sessionService.destroy(userId)
  await prisma.session.updateMany({
    where: { userId, isActive: true },
    data:  { isActive: false }
  })
}

// ─── Handle Failed Login Attempt ────────────────────────────
async function handleFailedAttempt(email) {
  const count = await sessionService.recordFailedAttempt(email)

  // Log to DB
  await prisma.failedLoginAttempt.create({ data: { email } }).catch(() => {})

  if (count >= sessionService.maxFails) {
    await sessionService.lock(email)
    // Email notification sent by auth controller (to keep service layer clean)
  }

  return count
}

// ─── Check User Status ───────────────────────────────────────
function checkUserStatus(user, role) {
  const status = user.status

  if (!status) return null // SuperAdmin has no status field

  const blockedStatuses = {
    DISPATCHER: ['SUSPENDED_TRANSFER', 'SUSPENDED_RESTORATION', 'INACTIVE', 'PENDING'],
    DRIVER:     ['SUSPENDED_TRANSFER', 'SUSPENDED_RESTORATION', 'INACTIVE', 'PENDING'],
    FLEET_ADMIN: [],
    AGENCY_ADMIN: []
  }

  // Check parent agency/fleet suspension
  // (full check done in middleware — here we just check the user record)
  if (status === 'SUSPENDED') {
    return { error: 'ACCOUNT_SUSPENDED', message: 'Your account has been suspended. Contact support.' }
  }

  if (blockedStatuses[role]?.includes(status)) {
    const messages = {
      PENDING:                'Your account is pending approval.',
      SUSPENDED_TRANSFER:     'Your account is suspended pending a transfer request.',
      SUSPENDED_RESTORATION:  'Your account is suspended pending restoration approval.',
      INACTIVE:               'Your account is inactive.'
    }
    return { error: 'ACCOUNT_STATUS_BLOCKED', message: messages[status] ?? 'Account not accessible.' }
  }

  return null
}

// ─── Strip Sensitive Fields From User Object ─────────────────
export function sanitizeUser(user, role) {
  const { password, ...safe } = user
  return { ...safe, role }
}

// ─── Get Full User By ID + Role ──────────────────────────────
export async function getUserById(id, role) {
  const model = ROLE_MODEL[role]
  if (!model) return null
  const user = await prisma[model].findUnique({ where: { id } })
  return user ? sanitizeUser(user, role) : null
}
