import 'express-async-errors'
import app from './app.js'
import { prisma } from './services/prisma.service.js'
import { sessionService } from './services/redis.service.js'
import { startScheduler } from './jobs/scheduler.js'

const PORT = process.env.PORT ?? 4000

async function start() {
  try {
    // Verify DB connection
    await prisma.$queryRaw`SELECT 1`
    console.log('[DB] Connected to Supabase PostgreSQL')

    app.listen(PORT, () => {
      console.log(`[Server] Running on http://localhost:${PORT}`)
      console.log(`[Server] Environment: ${process.env.NODE_ENV}`)
    })

    // Start background scheduled jobs
    startScheduler()
  } catch (err) {
    console.error('[Server] Startup failed:', err.message)
    process.exit(1)
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] Shutting down...')
  await prisma.$disconnect()
  process.exit(0)
})

start()
