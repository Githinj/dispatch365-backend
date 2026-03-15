import 'express-async-errors'
import express from 'express'
import authRoutes         from './routes/auth.routes.js'
import agencyRoutes       from './routes/agency.routes.js'
import fleetRoutes        from './routes/fleet.routes.js'
import dispatcherRoutes   from './routes/dispatcher.routes.js'
import driverRoutes       from './routes/driver.routes.js'
import vehicleRoutes      from './routes/vehicle.routes.js'
import loadRoutes         from './routes/load.routes.js'
import invoiceRoutes      from './routes/invoice.routes.js'
import notificationRoutes from './routes/notification.routes.js'
import superAdminRoutes   from './routes/superadmin.routes.js'
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js'

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.set('trust proxy', 1)

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/auth',          authRoutes)
app.use('/api/agencies',      agencyRoutes)
app.use('/api/fleets',        fleetRoutes)
app.use('/api/dispatchers',   dispatcherRoutes)
app.use('/api/drivers',       driverRoutes)
app.use('/api/vehicles',      vehicleRoutes)
app.use('/api/loads',         loadRoutes)
app.use('/api/invoices',      invoiceRoutes)
app.use('/api/receipts',      invoiceRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/super-admin',   superAdminRoutes)

app.use(notFoundHandler)
app.use(errorHandler)

export default app
