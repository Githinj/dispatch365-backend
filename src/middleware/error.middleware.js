import { respond } from '../utils/respond.js'
import { ZodError } from 'zod'

/**
 * Global error handler — must be the LAST middleware registered in app.js.
 * express-async-errors patches async route handlers so unhandled promise
 * rejections flow here automatically.
 */
export function errorHandler(err, req, res, next) {
  console.error('[Error]', err)

  // Zod validation errors
  if (err instanceof ZodError) {
    const errors = err.errors.map(e => ({
      field:   e.path.join('.'),
      message: e.message
    }))
    return respond.validationError(res, 'Validation failed.', errors)
  }

  // Prisma known errors
  if (err.code === 'P2002') {
    const field = err.meta?.target?.[0] ?? 'field'
    return respond.error(res, `A record with this ${field} already exists.`, 409, 'DUPLICATE_ENTRY')
  }

  if (err.code === 'P2025') {
    return respond.notFound(res, 'Record not found.')
  }

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return respond.error(res, 'File too large.', 413, 'FILE_TOO_LARGE')
  }
  if (err.message?.startsWith('Invalid file type') || err.message?.startsWith('Documents must') || err.message?.startsWith('Logo must')) {
    return respond.error(res, err.message, 400, 'INVALID_FILE_TYPE')
  }

  // JWT errors (should be caught in auth middleware, but fallback here)
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return respond.unauthorized(res, 'Invalid or expired token.')
  }

  // Default 500
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error.'
    : err.message

  return respond.error(res, message, 500, 'SERVER_ERROR')
}

/**
 * 404 handler — register BEFORE errorHandler, AFTER all routes.
 */
export function notFoundHandler(req, res) {
  return respond.error(res, `Route ${req.method} ${req.path} not found.`, 404, 'ROUTE_NOT_FOUND')
}
