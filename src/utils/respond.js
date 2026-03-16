/**
 * Standard response helper.
 * ALWAYS use this — never write res.json() directly in route handlers.
 */

export const respond = {
  success(res, data = null, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({ success: true, message, data })
  },

  created(res, data = null, message = 'Created') {
    return res.status(201).json({ success: true, message, data })
  },

  paginated(res, data, meta, message = 'Success') {
    return res.status(200).json({ success: true, message, data, meta })
  },

  error(res, message = 'Something went wrong', statusCode = 500, code = 'SERVER_ERROR') {
    return res.status(statusCode).json({ success: false, message, code })
  },

  notFound(res, message = 'Not found') {
    // Use 404 (not 403) when record exists but user has no access — prevents enumeration
    return res.status(404).json({ success: false, message, code: 'NOT_FOUND' })
  },

  forbidden(res, message = 'Access denied') {
    return res.status(403).json({ success: false, message, code: 'FORBIDDEN' })
  },

  unauthorized(res, message = 'Unauthorized') {
    return res.status(401).json({ success: false, message, code: 'UNAUTHORIZED' })
  },

  validationError(res, message = 'Validation failed', errors = []) {
    return res.status(422).json({ success: false, message, code: 'VALIDATION_ERROR', errors })
  },

  sessionInvalidated(res) {
    return res.status(401).json({
      success: false,
      message: 'Session invalidated. You have been logged in from another device.',
      code: 'SESSION_INVALIDATED'
    })
  }
}
