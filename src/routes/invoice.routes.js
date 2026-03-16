import { Router } from 'express'
import { authenticate }               from '../middleware/auth.middleware.js'
import { requireRole }                from '../middleware/role.middleware.js'
import { enforceAgencyIsolation }     from '../middleware/isolation.middleware.js'
import { enforceFinancialVisibility }  from '../middleware/financial.middleware.js'
import { auditLog }                   from '../middleware/audit.middleware.js'
import {
  listInvoicesHandler,
  getInvoiceHandler,
  recordPaymentHandler,
  raiseDisputeHandler,
  resolveDisputeHandler,
  getInvoicePDFHandler
} from '../controllers/invoice.controller.js'

const router = Router()

router.use(authenticate)

// ─── Middleware stack per PRD Section 22 ──────────────────────
// authenticate → requireRole → enforceAgencyIsolation → enforceFinancialVisibility → auditLog → handler

// List invoices — Agency Admin, Fleet Admin, Dispatcher, Super Admin
router.get('/',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  listInvoicesHandler
)

// ─── Static sub-paths BEFORE /:id ─────────────────────────────

// Get invoice by ID
router.get('/:id',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  getInvoiceHandler
)

// Record payment — Agency Admin only
router.post('/:id/record-payment',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'PAYMENT_RECORDED', entity: 'Invoice' }),
  recordPaymentHandler
)

// Raise dispute — Fleet Admin only
router.post('/:id/raise-dispute',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'DISPUTE_RAISED', entity: 'Invoice' }),
  raiseDisputeHandler
)

// Resolve dispute — Agency Admin only
router.post('/:id/resolve-dispute',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'DISPUTE_RESOLVED', entity: 'Invoice' }),
  resolveDisputeHandler
)

// Get invoice PDF signed URL
router.get('/:id/pdf',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  getInvoicePDFHandler
)

export default router
