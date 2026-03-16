import { Resend } from 'resend'

const FROM   = process.env.EMAIL_FROM || 'noreply@dispatch365.com'
const PLATFORM_NAME = 'Dispatch 365'

// Lazy client — avoids crash if RESEND_API_KEY is missing at import time
let _resend = null
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

// ─── HTML Escape ──────────────────────────────────────────────
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ─── Core Send ───────────────────────────────────────────────
async function send({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[email] SKIPPED (no RESEND_API_KEY): to=${to} subject="${subject}"`)
    return
  }
  try {
    await getResend().emails.send({ from: FROM, to, subject, html })
  } catch (err) {
    console.error(`[email] Failed to send to ${to}:`, err.message)
  }
}

// ─── Platform-branded base layout ────────────────────────────
function platformLayout(title, body) {
  return `
  <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
    <div style="background:#ea580c;padding:24px 32px">
      <h1 style="color:#fff;margin:0;font-size:20px">${PLATFORM_NAME}</h1>
    </div>
    <div style="padding:32px">${body}</div>
    <div style="background:#f9fafb;padding:16px 32px;font-size:12px;color:#6b7280">
      <p style="margin:0">Powered by ${PLATFORM_NAME}</p>
    </div>
  </div>`
}

// ─── Agency-branded base layout ──────────────────────────────
function agencyLayout(agency, body) {
  const logo = agency.logoUrl
    ? `<img src="${escapeHtml(agency.logoUrl)}" alt="${escapeHtml(agency.name)}" style="height:40px;margin-bottom:8px">`
    : `<strong style="font-size:18px">${escapeHtml(agency.name)}</strong>`
  const primary = agency.primaryColor || '#ea580c'
  const secondary = agency.secondaryColor || '#f9fafb'
  return `
  <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
    <div style="background:${primary};padding:24px 32px">
      ${logo}
    </div>
    <div style="padding:32px">${body}</div>
    <div style="background:${secondary};padding:16px 32px;font-size:12px;color:#6b7280">
      <p style="margin:0">${escapeHtml(agency.footerText || '')}</p>
      <p style="margin:4px 0 0">Powered by ${PLATFORM_NAME}</p>
    </div>
  </div>`
}

// ─── Agency Created — notify agency contact (owner) ──────────
export async function sendAgencyCreated({ to, ownerName, agencyName, plan }) {
  await send({
    to,
    subject: `Your agency "${escapeHtml(agencyName)}" is live on ${PLATFORM_NAME}`,
    html: platformLayout('Agency Created', `
      <p>Hi ${escapeHtml(ownerName)},</p>
      <p>Your agency <strong>${escapeHtml(agencyName)}</strong> has been successfully created on ${PLATFORM_NAME} under the <strong>${escapeHtml(plan)}</strong> plan.</p>
      <p>Your agency admin account has been set up and they will receive a separate email with their login credentials.</p>
      <p>You can now log in to the platform and start managing your dispatchers, fleets, and loads.</p>
    `)
  })
}

// ─── Agency Admin Welcome — send credentials to admin user ───
export async function sendAgencyAdminWelcome({ to, adminName, agencyName, temporaryPassword, loginUrl }) {
  await send({
    to,
    subject: `Welcome to ${PLATFORM_NAME} — your admin account is ready`,
    html: platformLayout('Welcome to Dispatch 365', `
      <p>Hi ${escapeHtml(adminName)},</p>
      <p>A <strong>${PLATFORM_NAME}</strong> agency admin account has been created for you under <strong>${escapeHtml(agencyName)}</strong>.</p>
      <p>Your login credentials:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:8px;color:#6b7280;width:140px">Email</td><td style="padding:8px;font-weight:600">${escapeHtml(to)}</td></tr>
        <tr style="background:#f9fafb"><td style="padding:8px;color:#6b7280">Password</td><td style="padding:8px;font-weight:600;font-family:monospace">${escapeHtml(temporaryPassword)}</td></tr>
      </table>
      <p><strong>Please change your password immediately after logging in.</strong></p>
      <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">Log In Now</a>
    `)
  })
}

// ─── Fleet Invite ─────────────────────────────────────────────
export async function sendFleetInvite({ to, adminName, agencyName, registrationUrl }) {
  await send({
    to,
    subject: `You've been invited to join ${escapeHtml(agencyName)} on ${PLATFORM_NAME}`,
    html: platformLayout('Fleet Invitation', `
      <p>Hi ${escapeHtml(adminName)},</p>
      <p><strong>${escapeHtml(agencyName)}</strong> has invited your fleet to join ${PLATFORM_NAME}.</p>
      <p>Click the button below to register your fleet and upload your documents:</p>
      <a href="${escapeHtml(registrationUrl)}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">Register Fleet</a>
      <p style="color:#6b7280;font-size:13px">This link expires in 48 hours.</p>
    `)
  })
}

// ─── Fleet Approved ───────────────────────────────────────────
export async function sendFleetApproved({ to, adminName, agencyName }) {
  await send({
    to,
    subject: `Your fleet has been approved on ${PLATFORM_NAME}`,
    html: platformLayout('Fleet Approved', `
      <p>Hi ${escapeHtml(adminName)},</p>
      <p>Your fleet registration has been <strong>approved</strong>. You are now active and can receive loads from <strong>${escapeHtml(agencyName)}</strong>.</p>
      <p>Log in to your fleet dashboard to get started.</p>
    `)
  })
}

// ─── Fleet Rejected ───────────────────────────────────────────
export async function sendFleetRejected({ to, adminName, reason }) {
  await send({
    to,
    subject: `Fleet registration update — ${PLATFORM_NAME}`,
    html: platformLayout('Registration Update', `
      <p>Hi ${escapeHtml(adminName)},</p>
      <p>Unfortunately your fleet registration could not be approved at this time.</p>
      <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
      <p>Please contact the platform administrator if you believe this is an error.</p>
    `)
  })
}

// ─── Driver Invite ────────────────────────────────────────────
export async function sendDriverInvite({ to, driverName, fleetName, inviteUrl }) {
  await send({
    to,
    subject: `You've been added as a driver at ${escapeHtml(fleetName)}`,
    html: platformLayout('Driver Invitation', `
      <p>Hi ${escapeHtml(driverName)},</p>
      <p>You have been added as a driver at <strong>${escapeHtml(fleetName)}</strong> on ${PLATFORM_NAME}.</p>
      <p>Click below to set your password and complete your profile:</p>
      <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">Set Up Account</a>
      <p style="color:#6b7280;font-size:13px">This link expires in 48 hours.</p>
    `)
  })
}

// ─── Load Assigned (agency-branded) ──────────────────────────
export async function sendLoadAssigned({ to, driverName, load, agency }) {
  await send({
    to,
    subject: `New load assigned: ${escapeHtml(load.loadNumber)}`,
    html: agencyLayout(agency, `
      <p>Hi ${escapeHtml(driverName)},</p>
      <p>A new load has been assigned to you.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:8px;color:#6b7280">Load #</td><td style="padding:8px;font-weight:600">${escapeHtml(load.loadNumber)}</td></tr>
        <tr style="background:#f9fafb"><td style="padding:8px;color:#6b7280">Pickup</td><td style="padding:8px">${escapeHtml(load.pickupLocation)}</td></tr>
        <tr><td style="padding:8px;color:#6b7280">Dropoff</td><td style="padding:8px">${escapeHtml(load.dropoffLocation)}</td></tr>
        <tr style="background:#f9fafb"><td style="padding:8px;color:#6b7280">Pickup Date</td><td style="padding:8px">${escapeHtml(new Date(load.pickupDate).toLocaleDateString())}</td></tr>
        <tr><td style="padding:8px;color:#6b7280">Delivery Date</td><td style="padding:8px">${escapeHtml(new Date(load.deliveryDate).toLocaleDateString())}</td></tr>
      </table>
      <p>Log in to your mobile app to view full details.</p>
    `)
  })
}

// ─── Delivery Submitted (agency-branded) ─────────────────────
export async function sendDeliverySubmitted({ to, dispatcherName, load, agency }) {
  await send({
    to,
    subject: `POD submitted for review — ${escapeHtml(load.loadNumber)}`,
    html: agencyLayout(agency, `
      <p>Hi ${escapeHtml(dispatcherName)},</p>
      <p>The driver has submitted proof of delivery for load <strong>${escapeHtml(load.loadNumber)}</strong>.</p>
      <p>Please log in to review the POD and accept or reject the delivery.</p>
    `)
  })
}

// ─── Load Completed (agency-branded) ─────────────────────────
export async function sendLoadCompleted({ to, recipientName, load, agency }) {
  await send({
    to,
    subject: `Load completed — ${escapeHtml(load.loadNumber)}`,
    html: agencyLayout(agency, `
      <p>Hi ${escapeHtml(recipientName)},</p>
      <p>Load <strong>${escapeHtml(load.loadNumber)}</strong> has been completed and an invoice has been generated.</p>
    `)
  })
}

// ─── Invoice Generated (agency-branded) ──────────────────────
export async function sendInvoiceGenerated({ to, recipientName, invoice, load, agency }) {
  await send({
    to,
    subject: `Invoice ${escapeHtml(invoice.invoiceNumber)} generated`,
    html: agencyLayout(agency, `
      <p>Hi ${escapeHtml(recipientName)},</p>
      <p>Invoice <strong>${escapeHtml(invoice.invoiceNumber)}</strong> has been generated for load ${escapeHtml(load.loadNumber)}.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:8px;color:#6b7280">Amount Due</td><td style="padding:8px;font-weight:600">$${escapeHtml(invoice.fleetEarnings.toFixed(2))}</td></tr>
        <tr style="background:#f9fafb"><td style="padding:8px;color:#6b7280">Due Date</td><td style="padding:8px">${escapeHtml(new Date(invoice.dueDate).toLocaleDateString())}</td></tr>
      </table>
    `)
  })
}

// ─── Invoice Due Reminder (agency-branded) ───────────────────
export async function sendInvoiceDueReminder({ to, recipientName, invoice, agency, daysUntilDue }) {
  await send({
    to,
    subject: `Invoice ${escapeHtml(invoice.invoiceNumber)} due in ${escapeHtml(daysUntilDue)} day(s)`,
    html: agencyLayout(agency, `
      <p>Hi ${escapeHtml(recipientName)},</p>
      <p>Invoice <strong>${escapeHtml(invoice.invoiceNumber)}</strong> is due in <strong>${escapeHtml(daysUntilDue)} day(s)</strong>.</p>
      <p>Amount: $${escapeHtml(invoice.fleetEarnings.toFixed(2))}</p>
    `)
  })
}

// ─── Invoice Overdue (agency-branded) ────────────────────────
export async function sendInvoiceOverdue({ to, recipientName, invoice, agency }) {
  await send({
    to,
    subject: `OVERDUE: Invoice ${escapeHtml(invoice.invoiceNumber)}`,
    html: agencyLayout(agency, `
      <p>Hi ${escapeHtml(recipientName)},</p>
      <p>Invoice <strong>${escapeHtml(invoice.invoiceNumber)}</strong> is now <strong>overdue</strong>. Please arrange payment immediately.</p>
      <p>Amount: $${escapeHtml(invoice.fleetEarnings.toFixed(2))}</p>
    `)
  })
}

// ─── Payment Recorded + Receipt (agency-branded) ─────────────
export async function sendPaymentRecorded({ to, recipientName, invoice, agency }) {
  await send({
    to,
    subject: `Payment received — Invoice ${invoice.invoiceNumber}`,
    html: agencyLayout(agency, `
      <p>Hi ${recipientName},</p>
      <p>Payment has been recorded for invoice <strong>${invoice.invoiceNumber}</strong>. A receipt has been generated.</p>
    `)
  })
}

// ─── Transfer Request (platform-branded) ─────────────────────
export async function sendTransferRequest({ to, adminName, dispatcherName, fromAgency, toAgency }) {
  await send({
    to,
    subject: `Transfer request: ${dispatcherName}`,
    html: platformLayout('Transfer Request', `
      <p>Hi ${adminName},</p>
      <p>Dispatcher <strong>${dispatcherName}</strong> has requested a transfer from <strong>${fromAgency}</strong> to <strong>${toAgency}</strong>.</p>
      <p>Please log in to approve or decline this request.</p>
    `)
  })
}

// ─── Transfer Approved (platform-branded) ────────────────────
export async function sendTransferApproved({ to, dispatcherName, toAgency }) {
  await send({
    to: to,
    subject: `Transfer approved — welcome to ${toAgency}`,
    html: platformLayout('Transfer Approved', `
      <p>Hi ${dispatcherName},</p>
      <p>Your transfer to <strong>${toAgency}</strong> has been approved. You are now active.</p>
    `)
  })
}

// ─── Transfer Declined (platform-branded) ────────────────────
export async function sendTransferDeclined({ to, dispatcherName, reason }) {
  await send({
    to,
    subject: 'Transfer request declined',
    html: platformLayout('Transfer Declined', `
      <p>Hi ${dispatcherName},</p>
      <p>Your transfer request has been declined.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
    `)
  })
}

// ─── Account Suspended (platform-branded) ────────────────────
export async function sendAccountSuspended({ to, name, reason }) {
  await send({
    to,
    subject: 'Your account has been suspended',
    html: platformLayout('Account Suspended', `
      <p>Hi ${name},</p>
      <p>Your account on ${PLATFORM_NAME} has been suspended.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
      <p>Contact your administrator if you believe this is an error.</p>
    `)
  })
}

// ─── Login Lockout (platform-branded) ────────────────────────
export async function sendLoginLockout({ to, name }) {
  await send({
    to,
    subject: 'Account temporarily locked',
    html: platformLayout('Account Locked', `
      <p>Hi ${name},</p>
      <p>Your account has been temporarily locked due to too many failed login attempts.</p>
      <p>Please try again in 15 minutes. If this was not you, contact support immediately.</p>
    `)
  })
}

// ─── Monthly Performance Summary (platform-branded) ──────────
export async function sendMonthlyPerformance({ to, name, stats }) {
  await send({
    to,
    subject: `Your monthly performance summary — ${new Date().toLocaleString('default', { month: 'long' })}`,
    html: platformLayout('Monthly Performance Summary', `
      <p>Hi ${name},</p>
      <p>Here is your performance summary for last month:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:8px;color:#6b7280">Loads Completed</td><td style="padding:8px;font-weight:600">${stats.totalLoadsCompleted}</td></tr>
        <tr style="background:#f9fafb"><td style="padding:8px;color:#6b7280">On-Time Rate</td><td style="padding:8px">${stats.onTimeDeliveryRate.toFixed(1)}%</td></tr>
        <tr><td style="padding:8px;color:#6b7280">Overall Rating</td><td style="padding:8px">${stats.overallRating.toFixed(2)} / 5.0</td></tr>
      </table>
    `)
  })
}
