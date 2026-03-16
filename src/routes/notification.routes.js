import { Router } from 'express'
import { authenticate } from '../middleware/auth.middleware.js'
import { requireRole }  from '../middleware/role.middleware.js'
import {
  listNotificationsHandler,
  getUnreadCountHandler,
  markAsReadHandler,
  markAllAsReadHandler,
  deleteNotificationHandler
} from '../controllers/notification.controller.js'

const router = Router()

router.use(authenticate)

// All authenticated roles can access their own notifications

// ─── Static sub-paths BEFORE /:id ─────────────────────────────

router.get('/unread-count',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN', 'DRIVER'),
  getUnreadCountHandler
)

router.post('/mark-all-read',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN', 'DRIVER'),
  markAllAsReadHandler
)

// List own notifications
router.get('/',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN', 'DRIVER'),
  listNotificationsHandler
)

// Mark one notification as read
router.patch('/:id/read',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN', 'DRIVER'),
  markAsReadHandler
)

// Delete a notification
router.delete('/:id',
  requireRole('SUPER_ADMIN', 'AGENCY_ADMIN', 'DISPATCHER', 'FLEET_ADMIN', 'DRIVER'),
  deleteNotificationHandler
)

export default router
