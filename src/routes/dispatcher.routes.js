import { Router } from 'express'
import { authenticate }              from '../middleware/auth.middleware.js'
import { requireRole }               from '../middleware/role.middleware.js'
import { enforceAgencyIsolation }    from '../middleware/isolation.middleware.js'
import { enforceFinancialVisibility } from '../middleware/financial.middleware.js'
import { auditLog }                  from '../middleware/audit.middleware.js'
import {
  createDispatcherHandler,
  listDispatchersHandler,
  getDispatcherHandler,
  updateProfileHandler,
  deactivateHandler,
  reactivateHandler,
  initiateTransferHandler,
  listTransfersHandler,
  approveTransferHandler,
  declineTransferHandler,
  cancelTransferHandler,
  initiateJoinRequestHandler,
  listJoinRequestsHandler,
  approveJoinRequestHandler,
  declineJoinRequestHandler,
  cancelJoinRequestHandler,
  createRatingHandler,
  getRatingsHandler,
  respondToRatingHandler,
  flagRatingHandler,
  removeRatingHandler
} from '../controllers/dispatcher.controller.js'

const router = Router()

// All dispatcher routes require authentication
router.use(authenticate)

// ─── Middleware stack per PRD Section 22 ─────────────────────
// authenticate → requireRole → enforceAgencyIsolation → enforceFinancialVisibility → auditLog → handler

// ── IMPORTANT: Static sub-paths must be defined BEFORE /:id ──

// ─── Transfer Routes ──────────────────────────────────────────

// Dispatcher initiates a transfer to another agency
router.post('/transfers',
  requireRole('DISPATCHER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'TRANSFER_REQUEST', entity: 'DispatcherTransferRequest' }),
  initiateTransferHandler
)

// List transfer requests (agency admin sees all involving their agency; dispatcher sees own)
router.get('/transfers',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  listTransfersHandler
)

// Agency Admin approves a transfer
router.post('/transfers/:requestId/approve',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'TRANSFER_APPROVE', entity: 'DispatcherTransferRequest' }),
  approveTransferHandler
)

// Agency Admin declines a transfer
router.post('/transfers/:requestId/decline',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'TRANSFER_DECLINE', entity: 'DispatcherTransferRequest' }),
  declineTransferHandler
)

// Dispatcher cancels their own transfer request
router.post('/transfers/:requestId/cancel',
  requireRole('DISPATCHER'),
  enforceAgencyIsolation,
  auditLog({ action: 'TRANSFER_CANCEL', entity: 'DispatcherTransferRequest' }),
  cancelTransferHandler
)

// ─── Join Request Routes ──────────────────────────────────────

// Dispatcher (INACTIVE) submits a join request to a new agency
router.post('/join-requests',
  requireRole('DISPATCHER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'JOIN_REQUEST', entity: 'DispatcherJoinRequest' }),
  initiateJoinRequestHandler
)

// List join requests
router.get('/join-requests',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  listJoinRequestsHandler
)

// Agency Admin approves a join request
router.post('/join-requests/:requestId/approve',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'JOIN_APPROVE', entity: 'DispatcherJoinRequest' }),
  approveJoinRequestHandler
)

// Agency Admin declines a join request
router.post('/join-requests/:requestId/decline',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'JOIN_DECLINE', entity: 'DispatcherJoinRequest' }),
  declineJoinRequestHandler
)

// Dispatcher cancels their own join request
router.post('/join-requests/:requestId/cancel',
  requireRole('DISPATCHER'),
  enforceAgencyIsolation,
  auditLog({ action: 'JOIN_CANCEL', entity: 'DispatcherJoinRequest' }),
  cancelJoinRequestHandler
)

// ─── Rating sub-routes (flat, not nested under /:id) ─────────
// Must be defined before /:id to avoid routing conflicts

// Dispatcher responds to a rating about themselves
router.post('/ratings/:ratingId/respond',
  requireRole('DISPATCHER'),
  enforceAgencyIsolation,
  auditLog({ action: 'RATING_RESPOND', entity: 'DispatcherRating' }),
  respondToRatingHandler
)

// Dispatcher flags a rating for Super Admin review
router.post('/ratings/:ratingId/flag',
  requireRole('DISPATCHER'),
  enforceAgencyIsolation,
  auditLog({ action: 'RATING_FLAG', entity: 'DispatcherRating' }),
  flagRatingHandler
)

// Super Admin removes a rating
router.delete('/ratings/:ratingId',
  requireRole('SUPER_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'RATING_REMOVE', entity: 'DispatcherRating' }),
  removeRatingHandler
)

// ─── Core Dispatcher Routes ───────────────────────────────────

// Create dispatcher — Agency Admin only
router.post('/',
  requireRole('AGENCY_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'CREATE', entity: 'Dispatcher' }),
  createDispatcherHandler
)

// List dispatchers
router.get('/',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  listDispatchersHandler
)

// Get dispatcher by ID
router.get('/:id',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  getDispatcherHandler
)

// Update dispatcher profile (dispatcher updates own; agency admin updates theirs)
router.patch('/:id',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'UPDATE', entity: 'Dispatcher' }),
  updateProfileHandler
)

// Deactivate dispatcher
router.post('/:id/deactivate',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'DEACTIVATE', entity: 'Dispatcher' }),
  deactivateHandler
)

// Reactivate dispatcher
router.post('/:id/reactivate',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'REACTIVATE', entity: 'Dispatcher' }),
  reactivateHandler
)

// Agency Admin submits a rating for a dispatcher
router.post('/:id/ratings',
  requireRole('AGENCY_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'CREATE', entity: 'DispatcherRating' }),
  createRatingHandler
)

// Get ratings for a dispatcher
router.get('/:id/ratings',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  getRatingsHandler
)

export default router
