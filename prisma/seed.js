/**
 * Seed script — run once to bootstrap the platform.
 * Creates: Super Admin account + subscription plan configs
 *
 * Usage: node prisma/seed.js
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // ─── Subscription Plan Configs ───────────────────────────
  await prisma.subscriptionPlanConfig.upsert({
    where:  { plan: 'BASIC' },
    update: {},
    create: { plan: 'BASIC',      monthlyPrice: 99,  maxDispatchers: 5,  description: 'Up to 5 dispatchers' }
  })
  await prisma.subscriptionPlanConfig.upsert({
    where:  { plan: 'PRO' },
    update: {},
    create: { plan: 'PRO',        monthlyPrice: 199, maxDispatchers: 15, description: 'Up to 15 dispatchers' }
  })
  await prisma.subscriptionPlanConfig.upsert({
    where:  { plan: 'ENTERPRISE' },
    update: {},
    create: { plan: 'ENTERPRISE', monthlyPrice: 499, maxDispatchers: -1, description: 'Unlimited dispatchers' }
  })
  console.log('✔ Subscription plan configs seeded')

  // ─── Platform Settings ───────────────────────────────────
  const defaultSettings = [
    { key: 'invoiceDueReminderDays',      value: '3',    description: 'Days before due date to send invoice reminder' },
    { key: 'transferReminderDays',        value: '3',    description: 'Days between transfer approval reminders' },
    { key: 'documentExpiryWarningDays',   value: '30',   description: 'Days before document expiry to warn' },
    { key: 'maintenanceReminderDays',     value: '7',    description: 'Days before maintenance stale alert' },
    { key: 'fleetReRequestCooldown',      value: '30',   description: 'Days before fleet can re-request after rejection' },
    { key: 'dispatcherJoinCooldown',      value: '30',   description: 'Days before dispatcher can re-apply after decline' },
    { key: 'trialPeriodDays',             value: '14',   description: 'Free trial period in days' },
    { key: 'gracePeriodDays',             value: '7',    description: 'Grace period after subscription expiry' },
    { key: 'autoSuspendOnExpiry',         value: 'true', description: 'Auto-suspend agency when subscription expires' },
    { key: 'webSessionTimeoutMinutes',    value: '30',   description: 'Web session inactivity timeout in minutes' },
    { key: 'mobileSessionTimeoutMinutes', value: '60',   description: 'Mobile session inactivity timeout in minutes' },
    { key: 'maxFailedLoginAttempts',      value: '5',    description: 'Max failed logins before account lock' },
    { key: 'loginLockoutMinutes',         value: '15',   description: 'Account lockout duration in minutes' }
  ]

  for (const setting of defaultSettings) {
    await prisma.platformSettings.upsert({
      where:  { key: setting.key },
      update: {},
      create: setting
    })
  }
  console.log('✔ Platform settings seeded')

  // ─── Super Admin Account ─────────────────────────────────
  const email    = 'admin@dispatch365.com'
  const password = 'Admin@123456'            // ← change after first login
  const hash     = await bcrypt.hash(password, 12)

  const existing = await prisma.superAdmin.findUnique({ where: { email } })
  if (!existing) {
    await prisma.superAdmin.create({
      data: { email, password: hash, name: 'Platform Admin' }
    })
    console.log(`✔ Super Admin created: ${email} / ${password}`)
    console.log('  ⚠️  Change this password immediately after first login.')
  } else {
    console.log(`ℹ  Super Admin already exists: ${email}`)
  }

  console.log('\nSeed complete.')
}

main()
  .catch(err => { console.error('Seed failed:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
