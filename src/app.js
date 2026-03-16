import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import authRoutes         from './routes/auth.routes.js'
import agencyRoutes       from './routes/agency.routes.js'
import fleetRoutes        from './routes/fleet.routes.js'
import dispatcherRoutes   from './routes/dispatcher.routes.js'
import driverRoutes       from './routes/driver.routes.js'
import vehicleRoutes      from './routes/vehicle.routes.js'
import loadRoutes         from './routes/load.routes.js'
import invoiceRoutes      from './routes/invoice.routes.js'
import receiptRoutes      from './routes/receipt.routes.js'
import notificationRoutes from './routes/notification.routes.js'
import superAdminRoutes   from './routes/superadmin.routes.js'
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js'

const app = express()

app.set('trust proxy', 1)

// Security headers
app.use(helmet())

// CORS — allow frontend origin
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-client-type'],
}))

// Global rate limit: 200 req / 15 min per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.', code: 'RATE_LIMITED' },
})
app.use(globalLimiter)

// Strict rate limit on login: 20 req / 15 min per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts, please try again later.', code: 'RATE_LIMITED' },
})

// Body parsing with size limits
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/auth',          loginLimiter, authRoutes)
app.use('/api/agencies',      agencyRoutes)
app.use('/api/fleets',        fleetRoutes)
app.use('/api/dispatchers',   dispatcherRoutes)
app.use('/api/drivers',       driverRoutes)
app.use('/api/vehicles',      vehicleRoutes)
app.use('/api/loads',         loadRoutes)
app.use('/api/invoices',      invoiceRoutes)
app.use('/api/receipts',      receiptRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/super-admin',   superAdminRoutes)

app.use(notFoundHandler)
app.use(errorHandler)

export default app
