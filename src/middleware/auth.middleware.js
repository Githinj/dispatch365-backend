import { verifyToken } from '../services/auth.service.js'
import { sessionService } from '../services/redis.service.js'
import { respond } from '../utils/respond.js'

/**
 * authenticate — Middleware #1 in the stack.
 *
 * 1. Extract Bearer token from Authorization header
 * 2. Verify JWT signature and expiry
 * 3. Check Redis — token must still be the active session for this user
 *    (if another login happened, the old token is invalidated in Redis)
 * 4. Attach req.user = { id, role, email, agencyId?, fleetId? }
 */
export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return respond.unauthorized(res, 'No token provided.')
  }

  const token = authHeader.slice(7)

  // 1. Verify JWT
  let payload
  try {
    payload = verifyToken(token)
  } catch {
    return respond.unauthorized(res, 'Invalid or expired token.')
  }

  const userId = payload.sub

  // 2. Check Redis — single session enforcement
  const activeToken = await sessionService.get(userId)
  if (!activeToken) {
    return respond.sessionInvalidated(res)
  }
  if (activeToken !== token) {
    return respond.sessionInvalidated(res)
  }

  // 3. Determine if mobile (for session refresh TTL)
  const isMobile = req.headers['x-client-type'] === 'mobile'

  // 4. Attach user context to request
  req.user = {
    id:        userId,
    role:      payload.role,
    email:     payload.email,
    agencyId:  payload.agencyId ?? null,
    fleetId:   payload.fleetId  ?? null
  }
  req.token    = token
  req.isMobile = isMobile

  next()
}
