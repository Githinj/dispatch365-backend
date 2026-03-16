import { respond } from '../utils/respond.js'

/**
 * requireRole — Middleware #2 in the stack.
 *
 * Usage:
 *   requireRole('AGENCY_ADMIN')
 *   requireRole('AGENCY_ADMIN', 'DISPATCHER')   — any of the listed roles
 *   requireRole('SUPER_ADMIN')
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return respond.unauthorized(res)

    if (!roles.includes(req.user.role)) {
      return respond.forbidden(res, 'You do not have permission to perform this action.')
    }

    next()
  }
}
