import { Router } from 'express'
import { authenticate } from '../middleware/auth.middleware.js'
import {
  loginHandler,
  logoutHandler,
  meHandler,
  refreshSessionHandler
} from '../controllers/auth.controller.js'

const router = Router()

// Public routes
router.post('/login',   loginHandler)

// Protected routes
router.post('/logout',          authenticate, logoutHandler)
router.get('/me',               authenticate, meHandler)
router.post('/refresh-session', authenticate, refreshSessionHandler)

export default router
