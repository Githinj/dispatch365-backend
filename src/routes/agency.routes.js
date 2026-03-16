import { Router } from 'express'
import { authenticate }              from '../middleware/auth.middleware.js'
import { requireRole }               from '../middleware/role.middleware.js'
import { enforceAgencyIsolation }    from '../middleware/isolation.middleware.js'
import { enforceFinancialVisibility } from '../middleware/financial.middleware.js'
import { auditLog }                  from '../middleware/audit.middleware.js'
import { uploadLogo }                from '../middleware/upload.middleware.js'
import {
  listAgencies,
  getAgency,
  updateAgencyHandler,
  updateBrandingHandler,
  suspendAgencyHandler,
  reactivateAgencyHandler
} from '../controllers/agency.controller.js'

const router = Router()

// All agency routes require authentication
router.use(authenticate)

// ─── Middleware stack per PRD Section 18 ────────────────────
// authenticate → requireRole → enforceAgencyIsolation → enforceFinancialVisibility → auditLog → handler

router.get('/',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  listAgencies
)

router.get('/:id',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  getAgency
)

router.patch('/:id',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'UPDATE', entity: 'Agency' }),
  updateAgencyHandler
)

// Branding — multipart (logo upload to Supabase Storage)
// Multer added AFTER isolation, BEFORE auditLog per Section 18
router.patch('/:id/branding',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  uploadLogo,
  auditLog({ action: 'UPDATE_BRANDING', entity: 'Agency' }),
  updateBrandingHandler
)

// Super Admin only — suspend and reactivate
router.post('/:id/suspend',
  requireRole('SUPER_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'SUSPEND', entity: 'Agency' }),
  suspendAgencyHandler
)

router.post('/:id/reactivate',
  requireRole('SUPER_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'REACTIVATE', entity: 'Agency' }),
  reactivateAgencyHandler
)

export default router
