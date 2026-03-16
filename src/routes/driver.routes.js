import { Router } from 'express'
import { authenticate }              from '../middleware/auth.middleware.js'
import { requireRole }               from '../middleware/role.middleware.js'
import { enforceAgencyIsolation }    from '../middleware/isolation.middleware.js'
import { enforceFinancialVisibility } from '../middleware/financial.middleware.js'
import { auditLog }                  from '../middleware/audit.middleware.js'
import { uploadDriverDocument }      from '../middleware/upload.middleware.js'
import {
  inviteDriverHandler,
  resendInviteHandler,
  validateInviteHandler,
  acceptInviteHandler,
  listDriversHandler,
  getDriverHandler,
  updateDriverHandler,
  deactivateDriverHandler,
  reactivateDriverHandler,
  uploadDocumentHandler,
  getDocumentsHandler,
  initiateTransferHandler,
  listTransfersHandler,
  approveTransferHandler,
  declineTransferHandler,
  cancelTransferHandler,
  initiateJoinRequestHandler,
  listJoinRequestsHandler,
  approveJoinRequestHandler,
  declineJoinRequestHandler,
  cancelJoinRequestHandler
} from '../controllers/driver.controller.js'

const router = Router()

// ─── Public routes (no auth) ──────────────────────────────────

router.get('/accept-invite/:token', validateInviteHandler)
router.post('/accept-invite/:token', acceptInviteHandler)

// ─── Authenticated routes ─────────────────────────────────────
// Middleware stack per PRD Section 22:
// authenticate → requireRole → enforceAgencyIsolation → enforceFinancialVisibility → [multer] → auditLog → handler

router.use(authenticate)

// ── Static sub-paths must be defined BEFORE /:id ──────────────

// ─── Invite ───────────────────────────────────────────────────

router.post('/invite',
  requireRole('FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'INVITE', entity: 'Driver' }),
  inviteDriverHandler
)

// ─── Transfer Routes ──────────────────────────────────────────

router.post('/transfers',
  requireRole('DRIVER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'TRANSFER_REQUEST', entity: 'DriverTransferRequest' }),
  initiateTransferHandler
)

router.get('/transfers',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN', 'DRIVER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  listTransfersHandler
)

router.post('/transfers/:requestId/approve',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'TRANSFER_APPROVE', entity: 'DriverTransferRequest' }),
  approveTransferHandler
)

router.post('/transfers/:requestId/decline',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'TRANSFER_DECLINE', entity: 'DriverTransferRequest' }),
  declineTransferHandler
)

router.post('/transfers/:requestId/cancel',
  requireRole('DRIVER'),
  enforceAgencyIsolation,
  auditLog({ action: 'TRANSFER_CANCEL', entity: 'DriverTransferRequest' }),
  cancelTransferHandler
)

// ─── Join Request Routes ──────────────────────────────────────

router.post('/join-requests',
  requireRole('DRIVER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'JOIN_REQUEST', entity: 'DriverJoinRequest' }),
  initiateJoinRequestHandler
)

router.get('/join-requests',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN', 'DRIVER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  listJoinRequestsHandler
)

router.post('/join-requests/:requestId/approve',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'JOIN_APPROVE', entity: 'DriverJoinRequest' }),
  approveJoinRequestHandler
)

router.post('/join-requests/:requestId/decline',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'JOIN_DECLINE', entity: 'DriverJoinRequest' }),
  declineJoinRequestHandler
)

router.post('/join-requests/:requestId/cancel',
  requireRole('DRIVER'),
  enforceAgencyIsolation,
  auditLog({ action: 'JOIN_CANCEL', entity: 'DriverJoinRequest' }),
  cancelJoinRequestHandler
)

// ─── Core Driver Routes ───────────────────────────────────────

router.get('/',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN', 'DRIVER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  listDriversHandler
)

router.get('/:id',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN', 'DRIVER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  getDriverHandler
)

router.patch('/:id',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN', 'DRIVER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'UPDATE', entity: 'Driver' }),
  updateDriverHandler
)

router.post('/:id/deactivate',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'DEACTIVATE', entity: 'Driver' }),
  deactivateDriverHandler
)

router.post('/:id/reactivate',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'REACTIVATE', entity: 'Driver' }),
  reactivateDriverHandler
)

router.post('/:id/resend-invite',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'RESEND_INVITE', entity: 'Driver' }),
  resendInviteHandler
)

// Documents — multer placed after isolation, before auditLog
router.post('/:id/documents',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN', 'DRIVER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  uploadDriverDocument,
  auditLog({ action: 'UPLOAD', entity: 'DriverDocument' }),
  uploadDocumentHandler
)

router.get('/:id/documents',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN', 'DRIVER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  getDocumentsHandler
)

export default router
