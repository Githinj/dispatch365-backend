import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { login, logout, getUserById, findUserByEmail } from '../services/auth.service.js'
import { sessionService } from '../services/redis.service.js'
import { prisma } from '../services/prisma.service.js'
import { respond } from '../utils/respond.js'
import { writeAuditLog } from '../middleware/audit.middleware.js'

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1)
})

// POST /api/auth/login
export async function loginHandler(req, res) {
  const { email, password } = loginSchema.parse(req.body)

  const isMobile = req.headers['x-client-type'] === 'mobile'
  const ipAddress = req.ip
  const deviceInfo = req.headers['user-agent']

  const result = await login({ email, password, isMobile, ipAddress, deviceInfo })

  if (result.error) {
    // Log failed attempt
    await writeAuditLog({
      actorId:    'unknown',
      actorRole:  'DRIVER', // placeholder for unknown
      actorEmail: email,
      actionType: 'LOGIN_FAILED',
      description: `Failed login attempt: ${result.error}`,
      entityType: 'Auth',
      ipAddress,
      deviceInfo
    })

    const statusCode = result.error === 'ACCOUNT_LOCKED' ? 423 : 401
    return respond.error(res, result.message, statusCode, result.error)
  }

  await writeAuditLog({
    actorId:    result.user.id,
    actorRole:  result.role,
    actorEmail: result.user.email,
    actionType: 'LOGIN',
    description: 'User logged in',
    entityType: 'Auth',
    entityId:   result.user.id,
    ipAddress,
    deviceInfo
  })

  return respond.success(res, { token: result.token, user: result.user }, 'Login successful.')
}

// POST /api/auth/logout
export async function logoutHandler(req, res) {
  await logout(req.user.id)

  await writeAuditLog({
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    actionType: 'LOGOUT',
    description: 'User logged out',
    entityType: 'Auth',
    entityId:   req.user.id,
    ipAddress:  req.ip,
    deviceInfo: req.headers['user-agent']
  })

  return respond.success(res, null, 'Logged out successfully.')
}

// GET /api/auth/me
export async function meHandler(req, res) {
  const user = await getUserById(req.user.id, req.user.role)
  if (!user) return respond.notFound(res, 'User not found.')
  return respond.success(res, user)
}

// POST /api/auth/change-password
export async function changePasswordHandler(req, res) {
  const { currentPassword, newPassword } = z.object({
    currentPassword: z.string().min(1),
    newPassword:     z.string().min(8, 'New password must be at least 8 characters')
  }).parse(req.body)

  const found = await findUserByEmail(req.user.email)
  if (!found) return respond.notFound(res, 'User not found.')

  const valid = await bcrypt.compare(currentPassword, found.user.password)
  if (!valid) return respond.error(res, 'Current password is incorrect.', 400, 'INVALID_PASSWORD')

  const hashed = await bcrypt.hash(newPassword, 12)

  const ROLE_MODEL = {
    SUPER_ADMIN:  'superAdmin',
    AGENCY_ADMIN: 'agencyUser',
    DISPATCHER:   'dispatcher',
    FLEET_ADMIN:  'fleetAdmin',
    DRIVER:       'driver'
  }
  const model = ROLE_MODEL[req.user.role]
  const updateData = { password: hashed }
  if (req.user.role === 'DISPATCHER') updateData.mustChangePassword = false
  await prisma[model].update({ where: { id: req.user.id }, data: updateData })

  await writeAuditLog({
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    actionType: 'UPDATE',
    description: 'User changed their password',
    entityType: 'Auth',
    entityId:   req.user.id,
    ipAddress:  req.ip,
    deviceInfo: req.headers['user-agent']
  })

  return respond.success(res, null, 'Password changed successfully.')
}

// POST /api/auth/refresh-session
export async function refreshSessionHandler(req, res) {
  const isMobile = req.isMobile

  // Extend Redis TTL (resets inactivity timer)
  const refreshed = await sessionService.refresh(req.user.id, { isMobile })

  if (!refreshed) return respond.sessionInvalidated(res)

  return respond.success(res, null, 'Session refreshed.')
}
