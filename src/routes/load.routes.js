import { Router } from 'express'
import { authenticate }               from '../middleware/auth.middleware.js'
import { requireRole }                from '../middleware/role.middleware.js'
import { enforceAgencyIsolation }     from '../middleware/isolation.middleware.js'
import { enforceFinancialVisibility }  from '../middleware/financial.middleware.js'
import { auditLog }                   from '../middleware/audit.middleware.js'
import { uploadPOD }                  from '../middleware/upload.middleware.js'
import {
  createLoadHandler,
  assignLoadHandler,
  updateLoadHandler,
  startTripHandler,
  submitDeliveryHandler,
  acceptDeliveryHandler,
  rejectDeliveryHandler,
  cancelLoadHandler,
  listLoadsHandler,
  getLoadHandler,
  getLoadPODHandler
} from '../controllers/load.controller.js'

const router = Router()

router.use(authenticate)

// ─── Middleware stack per PRD Section 22 ──────────────────────
// authenticate → requireRole → enforceAgencyIsolation → enforceFinancialVisibility → [multer] → auditLog → handler

// ─── Static sub-paths MUST be defined BEFORE /:id ─────────────

// Create load — Dispatcher only
router.post('/',
  requireRole('DISPATCHER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'CREATE', entity: 'Load' }),
  createLoadHandler
)

// List loads — all authenticated roles
router.get('/',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN', 'DRIVER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  listLoadsHandler
)

// ─── Load by ID and sub-actions ───────────────────────────────

// Assign load — Dispatcher only (DRAFT → ASSIGNED)
router.post('/:id/assign',
  requireRole('SUPER_ADMIN', 'DISPATCHER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'ASSIGN', entity: 'Load' }),
  assignLoadHandler
)

// Start trip — Driver only (ASSIGNED → IN_TRANSIT)
router.post('/:id/start-trip',
  requireRole('DRIVER'),
  enforceAgencyIsolation,
  auditLog({ action: 'TRIP_START', entity: 'Load' }),
  startTripHandler
)

// Submit delivery (POD) — Driver only (IN_TRANSIT → PENDING_DELIVERY_CONFIRMATION)
// multer before auditLog — see PRD middleware stack rule
router.post('/:id/submit-delivery',
  requireRole('DRIVER'),
  enforceAgencyIsolation,
  uploadPOD,
  auditLog({ action: 'POD_SUBMIT', entity: 'Load' }),
  submitDeliveryHandler
)

// Accept delivery — Dispatcher or Agency Admin (→ COMPLETED)
router.post('/:id/accept-delivery',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER'),
  enforceAgencyIsolation,
  auditLog({ action: 'DELIVERY_ACCEPT', entity: 'Load' }),
  acceptDeliveryHandler
)

// Reject delivery — Dispatcher or Agency Admin (→ back to IN_TRANSIT)
router.post('/:id/reject-delivery',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER'),
  enforceAgencyIsolation,
  auditLog({ action: 'DELIVERY_REJECT', entity: 'Load' }),
  rejectDeliveryHandler
)

// Cancel load — Dispatcher, Agency Admin, Super Admin; Fleet Admin (limited)
router.post('/:id/cancel',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'CANCEL', entity: 'Load' }),
  cancelLoadHandler
)

// Get POD signed URL — all parties with load access
router.get('/:id/pod',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN', 'DRIVER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  getLoadPODHandler
)

// Update load — Dispatcher only (DRAFT: full update; ASSIGNED: notes only)
router.patch('/:id',
  requireRole('SUPER_ADMIN', 'DISPATCHER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'UPDATE', entity: 'Load' }),
  updateLoadHandler
)

// Get load by ID — all authenticated roles
router.get('/:id',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN', 'DRIVER'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  getLoadHandler
)

export default router
