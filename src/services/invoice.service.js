import puppeteer from 'puppeteer'
import { prisma } from './prisma.service.js'
import { storageService } from './storage.service.js'
import { writeAuditLog } from '../middleware/audit.middleware.js'
import {
  sendInvoiceGenerated,
  sendPaymentRecorded
} from './email.service.js'
import { createNotification } from './notification.service.js'

// ─── Invoice Number Generator ──────────────────────────────────
async function generateInvoiceNumber() {
  const year   = new Date().getFullYear()
  const prefix = `INV-${year}-`
  const count  = await prisma.invoice.count({ where: { invoiceNumber: { startsWith: prefix } } })
  return `${prefix}${String(count + 1).padStart(4, '0')}`
}

// ─── Receipt Number Generator ──────────────────────────────────
async function generateReceiptNumber() {
  const year   = new Date().getFullYear()
  const prefix = `RCP-${year}-`
  const count  = await prisma.receipt.count({ where: { receiptNumber: { startsWith: prefix } } })
  return `${prefix}${String(count + 1).padStart(4, '0')}`
}

// ─── Generate Invoice (auto-called when Load → COMPLETED) ─────
// Creates the Invoice record, generates PDF, uploads to storage.
export async function generateInvoice(loadId) {
  // Full load with all needed relations
  const load = await prisma.load.findUnique({
    where:   { id: loadId },
    include: {
      agency:     true,
      fleet:      { select: { id: true, name: true, email: true, phone: true, address: true } },
      dispatcher: { select: { id: true, name: true, email: true } }
    }
  })

  if (!load) throw new Error(`generateInvoice: load ${loadId} not found`)
  if (load.status !== 'COMPLETED') throw new Error(`generateInvoice: load ${loadId} is not COMPLETED`)

  // Idempotency — invoice may already exist (e.g. retry)
  const existing = await prisma.invoice.findUnique({ where: { loadId } })
  if (existing) return existing

  const invoiceNumber = await generateInvoiceNumber()
  const completedAt   = load.completedAt ?? new Date()

  // dueDate = completedAt + agency.paymentTermsDays (fixed at generation)
  const dueDate = new Date(completedAt)
  dueDate.setDate(dueDate.getDate() + (load.agency.paymentTermsDays ?? 30))

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber,
      loadId:            load.id,
      agencyId:          load.agencyId,
      fleetId:           load.fleetId,
      loadRate:          load.loadRate,
      commissionPercent: load.commissionPercent,
      commissionAmount:  load.commissionAmount,
      dispatcherEarnings: load.dispatcherEarnings,
      fleetEarnings:     load.fleetEarnings,
      status:            'UNPAID',
      dueDate
    }
  })

  // Generate and upload PDF (best-effort — invoice already exists)
  try {
    const pdfBuffer = await renderInvoicePDF(invoice, load, load.agency, load.fleet)
    const pdfPath   = await storageService.uploadPDF(pdfBuffer, `${invoiceNumber}.pdf`, 'invoices')
    await prisma.invoice.update({ where: { id: invoice.id }, data: { pdfUrl: pdfPath } })
    invoice.pdfUrl = pdfPath
  } catch (err) {
    console.error('[Invoice] PDF generation failed:', err.message)
  }

  // Notify fleet admin
  try {
    if (load.fleet?.email) {
      await sendInvoiceGenerated({
        to:            load.fleet.email,
        recipientName: load.fleet.name,
        invoice,
        load,
        agency: load.agency
      })
    }
    // Look up fleet admin id for in-app notification
    const fleetAdmin = await prisma.fleetAdmin.findFirst({
      where:  { fleetId: load.fleetId },
      select: { id: true }
    })
    if (fleetAdmin) {
      await createNotification({
        userId:   fleetAdmin.id,
        userRole: 'FLEET_ADMIN',
        agencyId: load.agencyId,
        type:     'INVOICE_GENERATED',
        title:    'Invoice generated',
        message:  `Invoice ${invoiceNumber} for load ${load.loadNumber} is ready. Due: ${invoice.dueDate.toLocaleDateString()}.`,
        data:     { invoiceId: invoice.id, invoiceNumber, loadId: load.id }
      })
    }
  } catch (err) {
    console.error('[Invoice] Email notification failed:', err.message)
  }

  return invoice
}

// ─── List Invoices ─────────────────────────────────────────────
export async function listInvoices({ page = 1, perPage = 20, status, isolation } = {}) {
  const skip  = (page - 1) * perPage
  const where = {}

  if (status) where.status = status

  switch (isolation.role) {
    case 'AGENCY_ADMIN':
    case 'DISPATCHER':
      where.agencyId = isolation.agencyId
      break
    case 'FLEET_ADMIN':
      where.fleetId = isolation.fleetId
      break
    // SUPER_ADMIN: no filter
  }

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      skip,
      take:    perPage,
      orderBy: { generatedAt: 'desc' },
      include: {
        load:    { select: { id: true, loadNumber: true, pickupLocation: true, dropoffLocation: true } },
        fleet:   { select: { id: true, name: true } },
        receipt: { select: { id: true, receiptNumber: true } }
      }
    }),
    prisma.invoice.count({ where })
  ])

  return { data: invoices, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } }
}

// ─── Get Invoice By ID ─────────────────────────────────────────
export async function getInvoiceById(invoiceId, isolation) {
  const where = { id: invoiceId }

  switch (isolation.role) {
    case 'AGENCY_ADMIN':
    case 'DISPATCHER':
      where.agencyId = isolation.agencyId
      break
    case 'FLEET_ADMIN':
      where.fleetId = isolation.fleetId
      break
  }

  return prisma.invoice.findFirst({
    where,
    include: {
      load:    { select: { id: true, loadNumber: true, pickupLocation: true, dropoffLocation: true, pickupDate: true, deliveryDate: true } },
      fleet:   { select: { id: true, name: true } },
      agency:  { select: { id: true, name: true } },
      receipt: true
    }
  })
}

// ─── Record Payment ────────────────────────────────────────────
// AGENCY_ADMIN only. Records payment details; if fully paid → PAID + generates receipt.
export async function recordPayment(invoiceId, data, { actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const invoice = await prisma.invoice.findUnique({
    where:   { id: invoiceId },
    include: {
      load:   true,
      fleet:  { select: { id: true, name: true, email: true } },
      agency: true
    }
  })

  if (!invoice)                       return { error: 'NOT_FOUND',        message: 'Invoice not found.' }
  if (invoice.agencyId !== agencyId && actorRole !== 'SUPER_ADMIN')
                                      return { error: 'NOT_FOUND' }
  if (invoice.status === 'PAID')      return { error: 'ALREADY_PAID',     message: 'Invoice is already paid.' }
  if (invoice.isDisputed)             return { error: 'DISPUTED',         message: 'Cannot record payment on a disputed invoice. Resolve the dispute first.' }

  const { amountPaid, paymentMethod, paymentReference, paymentDate, paymentNotes } = data

  const newStatus = amountPaid >= invoice.fleetEarnings ? 'PAID' : 'PARTIALLY_PAID'
  const now       = new Date()

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid,
      paymentMethod,
      paymentReference: paymentReference ?? null,
      paymentDate:      paymentDate ? new Date(paymentDate) : now,
      paymentNotes:     paymentNotes ?? null,
      paidAt:           newStatus === 'PAID' ? now : null,
      recordedById:     actorId,
      status:           newStatus
    }
  })

  let receipt = null

  // Generate receipt only when fully paid
  if (newStatus === 'PAID') {
    receipt = await generateReceipt(updated, invoice, actorId, actorRole, actorEmail, ipAddress)
  }

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'PAYMENT_RECORDED',
    description: `Payment of $${amountPaid} recorded for invoice ${invoice.invoiceNumber} (${newStatus}).`,
    entityType:  'Invoice',
    entityId:    invoiceId,
    oldValue:    { status: invoice.status, amountPaid: invoice.amountPaid },
    newValue:    { status: newStatus, amountPaid },
    ipAddress,
    agencyId
  })

  // Notify fleet admin
  try {
    if (invoice.fleet?.email) {
      await sendPaymentRecorded({
        to:            invoice.fleet.email,
        recipientName: invoice.fleet.name,
        invoice:       updated,
        agency:        invoice.agency
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
        type:     'PAYMENT_RECORDED',
        title:    'Payment received',
        message:  `Payment of $${Number(amountPaid).toFixed(2)} recorded for invoice ${invoice.invoiceNumber}. Status: ${newStatus}.`,
        data:     { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, amountPaid, newStatus }
      })
    }
  } catch (err) {
    console.error('[Invoice] Payment notification failed:', err.message)
  }

  return { invoice: updated, receipt }
}

// ─── Raise Dispute ─────────────────────────────────────────────
// FLEET_ADMIN only. Marks invoice as disputed.
export async function raiseDispute(invoiceId, { reason }, { actorId, actorRole, actorEmail, ipAddress, fleetId }) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })

  if (!invoice)                       return { error: 'NOT_FOUND',        message: 'Invoice not found.' }
  if (actorRole === 'FLEET_ADMIN' && invoice.fleetId !== fleetId)
                                      return { error: 'NOT_FOUND' }
  if (invoice.status === 'PAID')      return { error: 'ALREADY_PAID',     message: 'Cannot dispute a paid invoice.' }
  if (invoice.isDisputed)             return { error: 'ALREADY_DISPUTED', message: 'Invoice is already disputed.' }

  const now = new Date()
  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data:  { isDisputed: true, disputeReason: reason, disputeRaisedAt: now, status: 'DISPUTED' }
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'DISPUTE_RAISED',
    description: `Dispute raised on invoice ${invoice.invoiceNumber}. Reason: ${reason}.`,
    entityType:  'Invoice',
    entityId:    invoiceId,
    oldValue:    { isDisputed: false, status: invoice.status },
    newValue:    { isDisputed: true, status: 'DISPUTED', disputeReason: reason },
    ipAddress,
    agencyId:    invoice.agencyId
  })

  return { invoice: updated }
}

// ─── Resolve Dispute ───────────────────────────────────────────
// AGENCY_ADMIN only. Clears dispute and restores appropriate status.
export async function resolveDispute(invoiceId, { resolution }, { actorId, actorRole, actorEmail, ipAddress, agencyId }) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })

  if (!invoice)                       return { error: 'NOT_FOUND',    message: 'Invoice not found.' }
  if (invoice.agencyId !== agencyId && actorRole !== 'SUPER_ADMIN')
                                      return { error: 'NOT_FOUND' }
  if (!invoice.isDisputed)            return { error: 'NOT_DISPUTED', message: 'Invoice is not disputed.' }

  const now = new Date()
  // Restore to UNPAID (or PARTIALLY_PAID if partial payment was recorded)
  const restoredStatus = invoice.amountPaid && invoice.amountPaid > 0 ? 'PARTIALLY_PAID' : 'UNPAID'

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data:  {
      isDisputed:           false,
      disputeResolvedAt:    now,
      disputeResolvedById:  actorId,
      status:               restoredStatus
    }
  })

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'DISPUTE_RESOLVED',
    description: `Dispute resolved on invoice ${invoice.invoiceNumber}. Resolution: ${resolution}.`,
    entityType:  'Invoice',
    entityId:    invoiceId,
    oldValue:    { isDisputed: true, status: 'DISPUTED' },
    newValue:    { isDisputed: false, status: restoredStatus },
    ipAddress,
    agencyId
  })

  return { invoice: updated }
}

// ─── Get Invoice PDF Signed URL ────────────────────────────────
export async function getInvoicePDF(invoiceId, isolation) {
  const invoice = await getInvoiceById(invoiceId, isolation)
  if (!invoice)           return { error: 'NOT_FOUND', message: 'Invoice not found.' }
  if (!invoice.pdfUrl)    return { error: 'NO_PDF',    message: 'Invoice PDF is not yet available.' }

  const signedUrl = await storageService.getSignedUrl(process.env.STORAGE_BUCKET_PDFS, invoice.pdfUrl)
  return { signedUrl }
}

// ─── List Receipts ─────────────────────────────────────────────
export async function listReceipts({ page = 1, perPage = 20, isolation } = {}) {
  const skip  = (page - 1) * perPage
  const where = {}

  switch (isolation.role) {
    case 'AGENCY_ADMIN':
    case 'DISPATCHER':
      where.agencyId = isolation.agencyId
      break
    case 'FLEET_ADMIN':
      where.fleetId = isolation.fleetId
      break
  }

  const [receipts, total] = await Promise.all([
    prisma.receipt.findMany({
      where,
      skip,
      take:    perPage,
      orderBy: { generatedAt: 'desc' },
      include: {
        invoice: { select: { id: true, invoiceNumber: true, status: true } }
      }
    }),
    prisma.receipt.count({ where })
  ])

  return { data: receipts, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } }
}

// ─── Get Receipt By ID ─────────────────────────────────────────
export async function getReceiptById(receiptId, isolation) {
  const where = { id: receiptId }

  switch (isolation.role) {
    case 'AGENCY_ADMIN':
    case 'DISPATCHER':
      where.agencyId = isolation.agencyId
      break
    case 'FLEET_ADMIN':
      where.fleetId = isolation.fleetId
      break
  }

  return prisma.receipt.findFirst({
    where,
    include: {
      invoice: {
        select: { id: true, invoiceNumber: true, loadId: true }
      }
    }
  })
}

// ─── Get Receipt PDF Signed URL ────────────────────────────────
export async function getReceiptPDF(receiptId, isolation) {
  const receipt = await getReceiptById(receiptId, isolation)
  if (!receipt)         return { error: 'NOT_FOUND', message: 'Receipt not found.' }
  if (!receipt.pdfUrl)  return { error: 'NO_PDF',    message: 'Receipt PDF is not yet available.' }

  const signedUrl = await storageService.getSignedUrl(process.env.STORAGE_BUCKET_PDFS, receipt.pdfUrl)
  return { signedUrl }
}

// ──────────────────────────────────────────────────────────────
// Private helpers
// ──────────────────────────────────────────────────────────────

// ─── Generate Receipt Record + PDF ────────────────────────────
async function generateReceipt(paidInvoice, originalInvoice, actorId, actorRole, actorEmail, ipAddress) {
  const receiptNumber = await generateReceiptNumber()

  const receipt = await prisma.receipt.create({
    data: {
      receiptNumber,
      invoiceId:        paidInvoice.id,
      loadId:           paidInvoice.loadId,
      agencyId:         paidInvoice.agencyId,
      fleetId:          paidInvoice.fleetId,
      loadRate:         paidInvoice.loadRate,
      commissionAmount: paidInvoice.commissionAmount,
      fleetEarnings:    paidInvoice.fleetEarnings,
      amountPaid:       paidInvoice.amountPaid,
      paymentMethod:    paidInvoice.paymentMethod,
      paymentReference: paidInvoice.paymentReference ?? null,
      paymentDate:      paidInvoice.paymentDate,
      paymentNotes:     paidInvoice.paymentNotes ?? null
    }
  })

  // Generate and upload receipt PDF (best-effort)
  try {
    const [agency, fleet] = await Promise.all([
      prisma.agency.findUnique({ where: { id: paidInvoice.agencyId } }),
      prisma.fleet.findFirst({ where: { id: paidInvoice.fleetId }, select: { id: true, name: true } })
    ])
    const pdfBuffer = await renderReceiptPDF(receipt, paidInvoice, agency, fleet)
    const pdfPath   = await storageService.uploadPDF(pdfBuffer, `${receiptNumber}.pdf`, 'receipts')
    await prisma.receipt.update({ where: { id: receipt.id }, data: { pdfUrl: pdfPath } })
    receipt.pdfUrl = pdfPath
  } catch (err) {
    console.error('[Receipt] PDF generation failed:', err.message)
  }

  await writeAuditLog({
    actorId,
    actorRole,
    actorEmail,
    actionType:  'RECEIPT_GENERATED',
    description: `Receipt ${receiptNumber} generated for invoice ${originalInvoice.invoiceNumber}.`,
    entityType:  'Receipt',
    entityId:    receipt.id,
    newValue:    { receiptNumber, invoiceId: paidInvoice.id },
    ipAddress,
    agencyId:    paidInvoice.agencyId
  })

  return receipt
}

// ─── Render Invoice PDF ────────────────────────────────────────
async function renderInvoicePDF(invoice, load, agency, fleet) {
  const html = buildInvoiceHTML(invoice, load, agency, fleet)
  return renderPDF(html)
}

// ─── Render Receipt PDF ────────────────────────────────────────
async function renderReceiptPDF(receipt, invoice, agency, fleet) {
  const html = buildReceiptHTML(receipt, invoice, agency, fleet)
  return renderPDF(html)
}

// ─── Puppeteer Core ────────────────────────────────────────────
async function renderPDF(html) {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({
      format:  'A4',
      margin:  { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
      printBackground: true
    })
    return pdf
  } finally {
    await browser.close()
  }
}

// ─── Invoice HTML Template ─────────────────────────────────────
function buildInvoiceHTML(invoice, load, agency, fleet) {
  const fmt   = (n) => `$${Number(n).toFixed(2)}`
  const fDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #1a1a2e; line-height: 1.5; }
  .page { padding: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; border-bottom: 3px solid #1a1a2e; padding-bottom: 20px; }
  .agency-name { font-size: 22px; font-weight: 700; color: #1a1a2e; }
  .agency-meta { font-size: 11px; color: #6b7280; margin-top: 4px; }
  .invoice-badge { text-align: right; }
  .invoice-badge h1 { font-size: 28px; font-weight: 800; color: #2563eb; letter-spacing: 1px; }
  .invoice-badge .inv-number { font-size: 13px; color: #374151; margin-top: 4px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; }
  .meta-box h3 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 8px; }
  .meta-box p { font-size: 13px; color: #1a1a2e; }
  .meta-box p + p { margin-top: 2px; }
  .load-section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin-bottom: 28px; }
  .load-section h3 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 12px; }
  .load-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .load-item label { font-size: 10px; color: #6b7280; display: block; }
  .load-item span { font-size: 12px; font-weight: 600; color: #1a1a2e; }
  .financials { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
  .financials th { background: #1a1a2e; color: white; padding: 10px 14px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .financials td { padding: 10px 14px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
  .financials tr:last-child td { border-bottom: none; }
  .financials .total-row td { background: #f0f9ff; font-weight: 700; font-size: 14px; color: #1d4ed8; }
  .status-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge-unpaid { background: #fef3c7; color: #d97706; }
  .badge-paid { background: #d1fae5; color: #065f46; }
  .badge-overdue { background: #fee2e2; color: #dc2626; }
  .badge-disputed { background: #ede9fe; color: #7c3aed; }
  .due-info { font-size: 12px; color: #6b7280; }
  .due-info strong { color: #dc2626; }
  .footer { border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 11px; color: #9ca3af; text-align: center; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="agency-name">${esc(agency.name)}</div>
      <div class="agency-meta">${esc(agency.address ?? '')}</div>
    </div>
    <div class="invoice-badge">
      <h1>INVOICE</h1>
      <div class="inv-number">${esc(invoice.invoiceNumber)}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <h3>Bill To</h3>
      <p>${esc(fleet?.name ?? '—')}</p>
    </div>
    <div class="meta-box">
      <h3>Invoice Details</h3>
      <p>Date Issued: ${fDate(invoice.generatedAt)}</p>
      <p>Due Date: ${fDate(invoice.dueDate)}</p>
      <p>Payment Terms: ${agency.paymentTermsDays ?? 30} days</p>
    </div>
  </div>

  <div class="load-section">
    <h3>Load Details</h3>
    <div class="load-grid">
      <div class="load-item"><label>Load Number</label><span>${esc(load.loadNumber)}</span></div>
      <div class="load-item"><label>Pickup Location</label><span>${esc(load.pickupLocation)}</span></div>
      <div class="load-item"><label>Dropoff Location</label><span>${esc(load.dropoffLocation)}</span></div>
      <div class="load-item"><label>Completed</label><span>${fDate(load.completedAt)}</span></div>
    </div>
  </div>

  <div class="status-row">
    <div>
      <span class="badge badge-${invoice.status.toLowerCase()}">${esc(invoice.status)}</span>
    </div>
    <div class="due-info">
      Amount Due: <strong>${fmt(invoice.fleetEarnings)}</strong>
    </div>
  </div>

  <table class="financials">
    <thead>
      <tr><th>Description</th><th style="text-align:right">Amount</th></tr>
    </thead>
    <tbody>
      <tr><td>Gross Load Rate</td><td style="text-align:right">${fmt(invoice.loadRate)}</td></tr>
      <tr><td>Agency Commission (${Number(invoice.commissionPercent).toFixed(1)}%)</td><td style="text-align:right">(${fmt(invoice.commissionAmount)})</td></tr>
      <tr class="total-row"><td>Net Amount Payable to Fleet</td><td style="text-align:right">${fmt(invoice.fleetEarnings)}</td></tr>
    </tbody>
  </table>

  <div class="footer">
    Generated by ${esc(agency.name)} • ${esc(invoice.invoiceNumber)} • ${fDate(invoice.generatedAt)}
  </div>
</div>
</body>
</html>`
}

// ─── Receipt HTML Template ─────────────────────────────────────
function buildReceiptHTML(receipt, invoice, agency, fleet) {
  const fmt   = (n) => `$${Number(n).toFixed(2)}`
  const fDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #1a1a2e; line-height: 1.5; }
  .page { padding: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; border-bottom: 3px solid #065f46; padding-bottom: 20px; }
  .agency-name { font-size: 22px; font-weight: 700; color: #1a1a2e; }
  .receipt-badge { text-align: right; }
  .receipt-badge h1 { font-size: 28px; font-weight: 800; color: #059669; letter-spacing: 1px; }
  .receipt-badge .rcp-number { font-size: 13px; color: #374151; margin-top: 4px; }
  .paid-stamp { text-align: center; margin: 20px 0; }
  .paid-stamp span { display: inline-block; border: 4px solid #059669; color: #059669; font-size: 32px; font-weight: 900; letter-spacing: 4px; padding: 8px 24px; border-radius: 4px; transform: rotate(-3deg); opacity: 0.8; }
  .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; }
  .detail-box h3 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 8px; }
  .detail-box p { font-size: 13px; color: #1a1a2e; }
  .detail-box p + p { margin-top: 2px; }
  .summary { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
  .summary th { background: #065f46; color: white; padding: 10px 14px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .summary td { padding: 10px 14px; border-bottom: 1px solid #e5e7eb; }
  .summary tr:last-child td { border-bottom: none; font-weight: 700; font-size: 14px; background: #ecfdf5; color: #065f46; }
  .footer { border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 11px; color: #9ca3af; text-align: center; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="agency-name">${esc(agency?.name ?? '')}</div>
    </div>
    <div class="receipt-badge">
      <h1>RECEIPT</h1>
      <div class="rcp-number">${esc(receipt.receiptNumber)}</div>
    </div>
  </div>

  <div class="paid-stamp"><span>PAID</span></div>

  <div class="detail-grid">
    <div class="detail-box">
      <h3>Paid To</h3>
      <p>${esc(fleet?.name ?? '—')}</p>
    </div>
    <div class="detail-box">
      <h3>Payment Details</h3>
      <p>Payment Date: ${fDate(receipt.paymentDate)}</p>
      <p>Method: ${esc(receipt.paymentMethod)}</p>
      ${receipt.paymentReference ? `<p>Reference: ${esc(receipt.paymentReference)}</p>` : ''}
    </div>
    <div class="detail-box">
      <h3>Invoice Reference</h3>
      <p>${esc(invoice?.invoiceNumber ?? '—')}</p>
      <p>Load: ${esc(receipt.loadId)}</p>
    </div>
    <div class="detail-box">
      <h3>Receipt Date</h3>
      <p>${fDate(receipt.generatedAt)}</p>
    </div>
  </div>

  <table class="summary">
    <thead>
      <tr><th>Description</th><th style="text-align:right">Amount</th></tr>
    </thead>
    <tbody>
      <tr><td>Gross Load Rate</td><td style="text-align:right">${fmt(receipt.loadRate)}</td></tr>
      <tr><td>Agency Commission Deducted</td><td style="text-align:right">(${fmt(receipt.commissionAmount)})</td></tr>
      <tr><td>Net Fleet Earnings</td><td style="text-align:right">${fmt(receipt.fleetEarnings)}</td></tr>
      <tr><td>Amount Paid</td><td style="text-align:right">${fmt(receipt.amountPaid)}</td></tr>
    </tbody>
  </table>

  <div class="footer">
    Receipt issued by ${esc(agency?.name ?? '')} • ${esc(receipt.receiptNumber)} • ${fDate(receipt.generatedAt)}
  </div>
</div>
</body>
</html>`
}

// ─── HTML escape helper ────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
