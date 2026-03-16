import { prisma } from '../services/prisma.service.js'
import { sendInvoiceOverdue } from '../services/email.service.js'
import { createNotification } from '../services/notification.service.js'

/**
 * Marks invoices past their due date as OVERDUE.
 * Sends email + in-app notification to fleet admin for each newly overdue invoice.
 * Safe to re-run — already-OVERDUE invoices are skipped.
 */
export async function runInvoiceOverdueJob() {
  const now = new Date()

  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      status:  { in: ['UNPAID', 'PARTIALLY_PAID'] },
      dueDate: { lt: now }
    },
    include: {
      agency: true,
      fleet:  { select: { id: true, name: true, email: true } }
    }
  })

  if (overdueInvoices.length === 0) return

  console.log(`[Job:invoiceOverdue] Marking ${overdueInvoices.length} invoice(s) as OVERDUE`)

  for (const invoice of overdueInvoices) {
    try {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data:  { status: 'OVERDUE' }
      })

      // Email fleet admin
      if (invoice.fleet?.email) {
        await sendInvoiceOverdue({
          to:            invoice.fleet.email,
          recipientName: invoice.fleet.name,
          invoice,
          agency: invoice.agency
        })
      }

      // In-app notification — look up fleet admin user id
      const fleetAdmin = await prisma.fleetAdmin.findFirst({
        where:  { fleetId: invoice.fleetId },
        select: { id: true }
      })
      if (fleetAdmin) {
        await createNotification({
          userId:   fleetAdmin.id,
          userRole: 'FLEET_ADMIN',
          agencyId: invoice.agencyId,
          type:     'INVOICE_OVERDUE',
          title:    'Invoice overdue',
          message:  `Invoice ${invoice.invoiceNumber} is overdue. Please arrange payment immediately.`,
          data:     { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber }
        })
      }
    } catch (err) {
      console.error(`[Job:invoiceOverdue] Failed for invoice ${invoice.invoiceNumber}:`, err.message)
    }
  }
}
