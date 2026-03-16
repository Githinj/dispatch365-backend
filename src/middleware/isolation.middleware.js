import { respond } from '../utils/respond.js'

/**
 * enforceAgencyIsolation — Middleware #3 in the stack.
 *
 * Injects req.isolation with scoped filters so every controller query
 * is automatically restricted to the requesting user's data.
 *
 * SUPER_ADMIN: no isolation — sees everything
 * AGENCY_ADMIN, DISPATCHER: scoped to their agencyId
 * FLEET_ADMIN: scoped to their fleetId
 * DRIVER: scoped to their own id + fleetId
 *
 * Rule (Section 16): Use 404 (not 403) when record exists but user has no access.
 * Controllers apply req.isolation as a WHERE clause — non-matching records
 * simply return empty/null, which the controller surfaces as 404.
 */
export function enforceAgencyIsolation(req, res, next) {
  if (!req.user) return respond.unauthorized(res)

  const { id, role, agencyId, fleetId } = req.user

  switch (role) {
    case 'SUPER_ADMIN':
      // No isolation — full platform access
      req.isolation = { role: 'SUPER_ADMIN' }
      break

    case 'AGENCY_ADMIN':
      if (!agencyId) return respond.forbidden(res, 'No agency associated with this account.')
      req.isolation = {
        role,
        agencyId,
        // Prisma WHERE clause helpers
        whereAgency:     { agencyId },
        whereOwnAgency:  { id: agencyId }
      }
      break

    case 'DISPATCHER':
      if (!agencyId) return respond.forbidden(res, 'No agency associated with this account.')
      req.isolation = {
        role,
        agencyId,
        dispatcherId: id,
        whereAgency:      { agencyId },
        whereDispatcher:  { dispatcherId: id, agencyId }
      }
      break

    case 'FLEET_ADMIN':
      if (!fleetId) return respond.forbidden(res, 'No fleet associated with this account.')
      req.isolation = {
        role,
        fleetId,
        whereFleet: { fleetId }
      }
      break

    case 'DRIVER':
      if (!fleetId) return respond.forbidden(res, 'No fleet associated with this account.')
      req.isolation = {
        role,
        driverId: id,
        fleetId,
        whereDriver: { driverId: id },
        whereFleet:  { fleetId }
      }
      break

    default:
      return respond.forbidden(res, 'Unknown role.')
  }

  next()
}
