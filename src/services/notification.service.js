import { prisma } from './prisma.service.js'

// ─── Create Notification (internal helper) ─────────────────────
// Called by other services to persist in-app notifications.
// Fire-and-forget — callers should wrap in try/catch.
export async function createNotification({ userId, userRole, agencyId = null, type, title, message, data = null }) {
  return prisma.notification.create({
    data: { userId, userRole, agencyId, type, title, message, data }
  })
}

// ─── List Notifications ────────────────────────────────────────
// Always scoped to the requesting user — users only see their own notifications.
export async function listNotifications(userId, { page = 1, perPage = 20, isRead } = {}) {
  const skip  = (page - 1) * perPage
  const where = { userId }

  if (typeof isRead === 'boolean') where.isRead = isRead

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      skip,
      take:    perPage,
      orderBy: { createdAt: 'desc' }
    }),
    prisma.notification.count({ where })
  ])

  return { data: notifications, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } }
}

// ─── Get Unread Count ──────────────────────────────────────────
export async function getUnreadCount(userId) {
  return prisma.notification.count({ where: { userId, isRead: false } })
}

// ─── Mark One As Read ──────────────────────────────────────────
export async function markAsRead(notificationId, userId) {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } })

  if (!notification)                  return { error: 'NOT_FOUND', message: 'Notification not found.' }
  if (notification.userId !== userId) return { error: 'NOT_FOUND', message: 'Notification not found.' }
  if (notification.isRead)            return { notification } // idempotent

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data:  { isRead: true, readAt: new Date() }
  })

  return { notification: updated }
}

// ─── Mark All As Read ──────────────────────────────────────────
export async function markAllAsRead(userId) {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data:  { isRead: true, readAt: new Date() }
  })

  return { count: result.count }
}

// ─── Delete Notification ───────────────────────────────────────
export async function deleteNotification(notificationId, userId) {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } })

  if (!notification)                  return { error: 'NOT_FOUND', message: 'Notification not found.' }
  if (notification.userId !== userId) return { error: 'NOT_FOUND', message: 'Notification not found.' }

  await prisma.notification.delete({ where: { id: notificationId } })
  return { success: true }
}
