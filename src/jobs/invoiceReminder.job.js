import { prisma } from '../services/prisma.service.js'
import { sendInvoiceDueReminder } from '../services/email.service.js'
import { createNotification } from '../services/notification.service.js'

// Reminder is sent when dueDate falls within this many days
const REMINDER_DAYS = 3

/**
 * Sends due-date reminder emails for invoices due in exactly REMINDER_DAYS days.
 * "Exactly" = dueDate falls within the next 24h window starting from REMINDER_DAYS days out.
 * This prevents duplicate sends across daily runs.
 */
export async function runInvoiceReminderJob() {
  const now       = new Date()
  const windowStart = new Date(now)
  windowStart.setDate(windowStart.getDate() + REMINDER_DAYS)
  windowStart.setHours(0, 0, 0, 0)

  const windowEnd = new Date(windowStart)
  windowEnd.setHours(23, 59, 59, 999)

  const invoices = await prisma.invoice.findMany({
    where: {
      status:  { in: ['UNPAID', 'PARTIALLY_PAID'] },
      dueDate: { gte: windowStart, lte: windowEnd }
    },
    include: {
      agency: true,
      fleet:  { select: { id: true, name: true, email: true } }
    }
  })

  if (invoices.length === 0) return

  console.log(`[Job:invoiceReminder] Sending ${invoices.length} reminder(s) (due in ${REMINDER_DAYS} days)`)

  for (const invoice of invoices) {
    try {
      if (invoice.fleet?.email) {
        await sendInvoiceDueReminder({
          to:            invoice.fleet.email,
          recipientName: invoice.fleet.name,
          invoice,
          agency:        invoice.agency,
          daysUntilDue:  REMINDER_DAYS
        })
      }

      const fleetAdmin = await prisma.fleetAdmin.findFirst({
        where:  { fleetId: invoice.fleetId },
        select: { id: true }
      })
      if (fleetAdmin) {
        await createNotification({
          userId:   fleetAdmin.id,
          userRole: 'FLEET_ADMIN',
          agencyId: invoice.agencyId,
          type:     'INVOICE_DUE_REMINDER',
          title:    `Invoice due in ${REMINDER_DAYS} days`,
          message:  `Invoice ${invoice.invoiceNumber} is due in ${REMINDER_DAYS} days. Amount: $${Number(invoice.fleetEarnings).toFixed(2)}.`,
          data:     { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, daysUntilDue: REMINDER_DAYS }
        })
      }
    } catch (err) {
      console.error(`[Job:invoiceReminder] Failed for invoice ${invoice.invoiceNumber}:`, err.message)
    }
  }
}
