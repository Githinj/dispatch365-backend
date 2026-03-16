/**
 * enforceFinancialVisibility — Middleware #4 in the stack.
 *
 * Strips financial fields from response bodies based on the requesting user's role.
 * Enforced at API level — never rely on UI to hide these fields.
 *
 * Visibility matrix (Section 12 of PRD):
 *
 * Field               SUPER_ADMIN  AGENCY_ADMIN  DISPATCHER  FLEET_ADMIN  DRIVER
 * loadRate            YES          YES           YES         YES          NO
 * commissionPercent   YES          YES           NO          YES          NO
 * commissionAmount    YES          YES           NO          YES          NO
 * dispatcherEarnings  YES          YES           YES         NO           NO
 * fleetEarnings       YES          YES           NO          YES          NO
 * platformRevenue     YES          NO            NO          NO           NO
 *
 * Works by overriding res.json() — strips fields before sending response.
 */

const FIELD_RULES = {
  commissionPercent:  ['SUPER_ADMIN', 'AGENCY_ADMIN', 'FLEET_ADMIN'],
  commissionAmount:   ['SUPER_ADMIN', 'AGENCY_ADMIN', 'FLEET_ADMIN'],
  dispatcherEarnings: ['SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER'],
  fleetEarnings:      ['SUPER_ADMIN', 'AGENCY_ADMIN', 'FLEET_ADMIN'],
  platformRevenue:    ['SUPER_ADMIN'],
  loadRate:           ['SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN']
}

// Fields that are ALWAYS stripped (never exposed via API regardless of role)
const ALWAYS_STRIP = ['password']

export function enforceFinancialVisibility(req, res, next) {
  const role = req.user?.role
  if (!role) return next()

  const originalJson = res.json.bind(res)

  res.json = function (body) {
    const stripped = stripFields(body, role)
    return originalJson(stripped)
  }

  next()
}

function stripFields(data, role) {
  if (data === null || data === undefined) return data
  if (Array.isArray(data)) return data.map(item => stripFields(item, role))

  if (typeof data === 'object') {
    const result = { ...data }

    // Strip password everywhere
    for (const field of ALWAYS_STRIP) {
      delete result[field]
    }

    // Strip financial fields based on role
    for (const [field, allowedRoles] of Object.entries(FIELD_RULES)) {
      if (field in result && !allowedRoles.includes(role)) {
        delete result[field]
      }
    }

    // Recurse into nested objects (data wrapper, paginated responses, etc.)
    for (const key of Object.keys(result)) {
      if (typeof result[key] === 'object' && result[key] !== null) {
        result[key] = stripFields(result[key], role)
      }
    }

    return result
  }

  return data
}
