import { z } from 'zod'
import { login, logout, getUserById } from '../services/auth.service.js'
import { sessionService } from '../services/redis.service.js'
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

// POST /api/auth/refresh-session
export async function refreshSessionHandler(req, res) {
  const isMobile = req.isMobile

  // Extend Redis TTL (resets inactivity timer)
  const refreshed = await sessionService.refresh(req.user.id, { isMobile })

  if (!refreshed) return respond.sessionInvalidated(res)

  return respond.success(res, null, 'Session refreshed.')
}
