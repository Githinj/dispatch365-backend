import { runInvoiceOverdueJob }      from './invoiceOverdue.job.js'
import { runInvoiceReminderJob }     from './invoiceReminder.job.js'
import { runSessionCleanupJob }      from './sessionCleanup.job.js'
import { runFailedLoginCleanupJob }  from './failedLoginCleanup.job.js'

const HOUR  = 60 * 60 * 1000
const DAY   = 24 * HOUR

// ─── Job registry ─────────────────────────────────────────────
// Each entry: { name, fn, interval (ms), runOnStartup }
const JOBS = [
  {
    name:         'invoiceOverdue',
    fn:           runInvoiceOverdueJob,
    interval:     DAY,
    runOnStartup: true
  },
  {
    name:         'invoiceReminder',
    fn:           runInvoiceReminderJob,
    interval:     DAY,
    runOnStartup: true
  },
  {
    name:         'sessionCleanup',
    fn:           runSessionCleanupJob,
    interval:     DAY,
    runOnStartup: false   // not urgent at startup
  },
  {
    name:         'failedLoginCleanup',
    fn:           runFailedLoginCleanupJob,
    interval:     6 * HOUR,
    runOnStartup: false
  }
]

// ─── Wrap job to catch and log errors without crashing ────────
function safe(name, fn) {
  return async () => {
    try {
      await fn()
    } catch (err) {
      console.error(`[Scheduler] Job "${name}" failed:`, err.message)
    }
  }
}

// ─── Start all jobs ───────────────────────────────────────────
export function startScheduler() {
  for (const job of JOBS) {
    const safeFn = safe(job.name, job.fn)

    // Schedule recurring run
    setInterval(safeFn, job.interval)

    // Run once at startup (small delay to let DB/Redis settle)
    if (job.runOnStartup) {
      setTimeout(safeFn, 5000)
    }

    const intervalLabel = job.interval >= DAY
      ? `${job.interval / DAY}d`
      : `${job.interval / HOUR}h`

    console.log(`[Scheduler] Registered "${job.name}" — every ${intervalLabel}${job.runOnStartup ? ', runs on startup' : ''}`)
  }
}
