import { Router } from 'express'
import { authenticate }              from '../middleware/auth.middleware.js'
import { requireRole }               from '../middleware/role.middleware.js'
import { enforceAgencyIsolation }    from '../middleware/isolation.middleware.js'
import { enforceFinancialVisibility } from '../middleware/financial.middleware.js'
import { auditLog }                  from '../middleware/audit.middleware.js'
import {
  createVehicleHandler,
  listVehiclesHandler,
  getVehicleHandler,
  updateVehicleHandler,
  deactivateVehicleHandler,
  reactivateVehicleHandler,
  startMaintenanceHandler,
  completeMaintenanceHandler,
  listMaintenanceHandler
} from '../controllers/vehicle.controller.js'

const router = Router()

router.use(authenticate)

// ─── Middleware stack per PRD Section 22 ─────────────────────
// authenticate → requireRole → enforceAgencyIsolation → enforceFinancialVisibility → auditLog → handler

// Create vehicle — Fleet Admin only
router.post('/',
  requireRole('FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'CREATE', entity: 'Vehicle' }),
  createVehicleHandler
)

// List vehicles — Fleet Admin (own fleet), Agency Admin & Dispatcher (by fleetId param), Super Admin (all)
router.get('/',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  listVehiclesHandler
)

// Get vehicle by ID
router.get('/:id',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  getVehicleHandler
)

// Update vehicle details — Fleet Admin only
router.patch('/:id',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  auditLog({ action: 'UPDATE', entity: 'Vehicle' }),
  updateVehicleHandler
)

// Deactivate vehicle — Fleet Admin only
router.post('/:id/deactivate',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'DEACTIVATE', entity: 'Vehicle' }),
  deactivateVehicleHandler
)

// Reactivate vehicle — Fleet Admin only
router.post('/:id/reactivate',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'REACTIVATE', entity: 'Vehicle' }),
  reactivateVehicleHandler
)

// Start maintenance — Fleet Admin only
// PRD rule: vehicle under maintenance can never be assigned to a load
router.post('/:id/maintenance/start',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'MAINTENANCE_START', entity: 'Vehicle' }),
  startMaintenanceHandler
)

// Complete maintenance — Fleet Admin only
router.post('/:id/maintenance/complete',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  auditLog({ action: 'MAINTENANCE_COMPLETE', entity: 'Vehicle' }),
  completeMaintenanceHandler
)

// List maintenance history for a vehicle
router.get('/:id/maintenance',
  requireRole('SUPER_ADMIN', 'FLEET_ADMIN'),
  enforceAgencyIsolation,
  enforceFinancialVisibility,
  listMaintenanceHandler
)

export default router
