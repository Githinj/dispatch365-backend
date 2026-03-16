import { Router } from 'express'
import { authenticate }               from '../middleware/auth.middleware.js'
import { requireRole }                from '../middleware/role.middleware.js'
import { enforceAgencyIsolation }     from '../middleware/isolation.middleware.js'
import { enforceFinancialVisibility }  from '../middleware/financial.middleware.js'
import {
  listReceiptsHandler,
  getReceiptHandler,
  getReceiptPDFHandler
} from '../controllers/invoice.controller.js'

const router = Router()

router.use(authenticate)

// List receipts
router.get('/',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  listReceiptsHandler
)

// Get receipt by ID
router.get('/:id',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  getReceiptHandler
)

// Get receipt PDF signed URL
router.get('/:id/pdf',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  getReceiptPDFHandler
)

export default router
