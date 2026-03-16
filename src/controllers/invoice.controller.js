import { z } from 'zod'
import { respond } from '../utils/respond.js'
import {
  listInvoices,
  getInvoiceById,
  recordPayment,
  raiseDispute,
  resolveDispute,
  getInvoicePDF,
  listReceipts,
  getReceiptById,
  getReceiptPDF
} from '../services/invoice.service.js'

// ─── Validation Schemas ───────────────────────────────────────

const recordPaymentSchema = z.object({
  amountPaid:       z.number().positive(),
  paymentMethod:    z.enum(['BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER']),
  paymentReference: z.string().max(200).optional(),
  paymentDate:      z.string().datetime().optional(),
  paymentNotes:     z.string().max(1000).optional()
}).strict()

const raiseDisputeSchema = z.object({
  reason: z.string().min(1).max(1000)
}).strict()

const resolveDisputeSchema = z.object({
  resolution: z.string().min(1).max(1000)
}).strict()

// ─── GET /api/invoices ────────────────────────────────────────
export async function listInvoicesHandler(req, res) {
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '20')
  const status  = req.query.status ?? undefined

  const result = await listInvoices({ page, perPage, status, isolation: req.isolation })
  return respond.paginated(res, result.data, result.meta)
}

// ─── GET /api/invoices/:id ────────────────────────────────────
export async function getInvoiceHandler(req, res) {
  const invoice = await getInvoiceById(req.params.id, req.isolation)
  if (!invoice) return respond.notFound(res)
  return respond.success(res, invoice)
}

// ─── POST /api/invoices/:id/record-payment ────────────────────
export async function recordPaymentHandler(req, res) {
  const data   = recordPaymentSchema.parse(req.body)
  const result = await recordPayment(req.params.id, data, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId
  })

  if (result.error === 'NOT_FOUND')        return respond.notFound(res, result.message)
  if (result.error === 'ALREADY_PAID')     return respond.error(res, result.message, 409, 'ALREADY_PAID')
  if (result.error === 'DISPUTED')         return respond.error(res, result.message, 409, 'DISPUTED')

  return respond.success(res, { invoice: result.invoice, receipt: result.receipt }, 'Payment recorded successfully.')
}

// ─── POST /api/invoices/:id/raise-dispute ─────────────────────
export async function raiseDisputeHandler(req, res) {
  const { reason } = raiseDisputeSchema.parse(req.body)
  const result = await raiseDispute(req.params.id, { reason }, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    fleetId:    req.user.fleetId ?? null
  })

  if (result.error === 'NOT_FOUND')          return respond.notFound(res, result.message)
  if (result.error === 'ALREADY_PAID')       return respond.error(res, result.message, 409, 'ALREADY_PAID')
  if (result.error === 'ALREADY_DISPUTED')   return respond.error(res, result.message, 409, 'ALREADY_DISPUTED')

  return respond.success(res, result.invoice, 'Dispute raised successfully.')
}

// ─── POST /api/invoices/:id/resolve-dispute ───────────────────
export async function resolveDisputeHandler(req, res) {
  const { resolution } = resolveDisputeSchema.parse(req.body)
  const result = await resolveDispute(req.params.id, { resolution }, {
    actorId:    req.user.id,
    actorRole:  req.user.role,
    actorEmail: req.user.email,
    ipAddress:  req.ip,
    agencyId:   req.user.agencyId
  })

  if (result.error === 'NOT_FOUND')    return respond.notFound(res, result.message)
  if (result.error === 'NOT_DISPUTED') return respond.error(res, result.message, 409, 'NOT_DISPUTED')

  return respond.success(res, result.invoice, 'Dispute resolved.')
}

// ─── GET /api/invoices/:id/pdf ────────────────────────────────
export async function getInvoicePDFHandler(req, res) {
  const result = await getInvoicePDF(req.params.id, req.isolation)
  if (result.error === 'NOT_FOUND') return respond.notFound(res, result.message)
  if (result.error === 'NO_PDF')    return respond.error(res, result.message, 404, 'NO_PDF')
  return respond.success(res, { signedUrl: result.signedUrl })
}

// ─── GET /api/receipts ────────────────────────────────────────
export async function listReceiptsHandler(req, res) {
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '20')

  const result = await listReceipts({ page, perPage, isolation: req.isolation })
  return respond.paginated(res, result.data, result.meta)
}

// ─── GET /api/receipts/:id ────────────────────────────────────
export async function getReceiptHandler(req, res) {
  const receipt = await getReceiptById(req.params.id, req.isolation)
  if (!receipt) return respond.notFound(res)
  return respond.success(res, receipt)
}

// ─── GET /api/receipts/:id/pdf ────────────────────────────────
export async function getReceiptPDFHandler(req, res) {
  const result = await getReceiptPDF(req.params.id, req.isolation)
  if (result.error === 'NOT_FOUND') return respond.notFound(res, result.message)
  if (result.error === 'NO_PDF')    return respond.error(res, result.message, 404, 'NO_PDF')
  return respond.success(res, { signedUrl: result.signedUrl })
}
