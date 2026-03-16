import { Router } from 'express'
import { authenticate }              from '../middleware/auth.middleware.js'
import { requireRole }               from '../middleware/role.middleware.js'
import { enforceAgencyIsolation }    from '../middleware/isolation.middleware.js'
import { enforceFinancialVisibility } from '../middleware/financial.middleware.js'
import { auditLog }                  from '../middleware/audit.middleware.js'
import { uploadDocument, uploadFleetRegistrationDocs } from '../middleware/upload.middleware.js'
import {
  inviteFleetHandler,
  validateTokenHandler,
  registerFleetHandler,
  listFleetsHandler,
  getFleetHandler,
  updateFleetHandler,
  approveFleetHandler,
  rejectFleetHandler,
  suspendFleetHandler,
  reactivateFleetHandler,
  getDocumentsHandler,
  uploadDocumentHandler,
  updateRelationshipHandler,
  resendInviteHandler
} from '../controllers/fleet.controller.js'

const router = Router()

// ─── Public routes (no auth) ─────────────────────────────────
// Used by fleet admin to complete registration via emailed link

router.get('/register/:token', validateTokenHandler)

router.post('/register/:token',
  uploadFleetRegistrationDocs,
  registerFleetHandler
)

// ─── Authenticated routes ─────────────────────────────────────
// Middleware stack per PRD Section 22:
// authenticate → requireRole → enforceAgencyIsolation → enforceFinancialVisibility → [multer] → auditLog → handler

router.use(authenticate)

// Invite fleet — Agency Admin only
router.post('/invite',
  requireRole('AGENCY_ADMIN', 'SUPER_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'INVITE', entity: 'Fleet' }),
  inviteFleetHandler
)

// List fleets
router.get('/',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  listFleetsHandler
)

// Get fleet by ID
router.get('/:id',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  getFleetHandler
)

// Update fleet profile — Fleet Admin only (own fleet)
router.patch('/:id',
  requireRole('FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'UPDATE', entity: 'Fleet' }),
  updateFleetHandler
)

// Approve fleet — Agency Admin or Super Admin
router.post('/:id/approve',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'APPROVE', entity: 'Fleet' }),
  approveFleetHandler
)

// Reject fleet — Agency Admin or Super Admin
router.post('/:id/reject',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'REJECT', entity: 'Fleet' }),
  rejectFleetHandler
)

// Suspend fleet — Agency Admin or Super Admin
router.post('/:id/suspend',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'SUSPEND', entity: 'Fleet' }),
  suspendFleetHandler
)

// Reactivate fleet — Agency Admin or Super Admin
router.post('/:id/reactivate',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'REACTIVATE', entity: 'Fleet' }),
  reactivateFleetHandler
)

// Get fleet documents (with signed URLs) — Agency Admin, Fleet Admin, Super Admin
router.get('/:id/documents',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  getDocumentsHandler
)

// Upload a fleet document — Fleet Admin only
router.post('/:id/documents',
  requireRole('FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  uploadDocument,
  auditLog({ action: 'UPLOAD', entity: 'FleetDocument' }),
  uploadDocumentHandler
)

// Update commission for fleet relationship — Agency Admin or Super Admin
router.patch('/:id/relationship',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'UPDATE', entity: 'AgencyFleetRelationship' }),
  updateRelationshipHandler
)

// Resend invite — Agency Admin or Super Admin
router.post('/:id/resend-invite',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'RESEND_INVITE', entity: 'Fleet' }),
  resendInviteHandler
)

export default router
