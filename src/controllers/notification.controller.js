import { respond } from '../utils/respond.js'
import {
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification
} from '../services/notification.service.js'

// ─── GET /api/notifications ───────────────────────────────────
export async function listNotificationsHandler(req, res) {
  const page    = parseInt(req.query.page    ?? '1')
  const perPage = parseInt(req.query.perPage ?? '20')

  // ?isRead=true|false — optional filter
  let isRead
  if (req.query.isRead === 'true')  isRead = true
  if (req.query.isRead === 'false') isRead = false

  const result = await listNotifications(req.user.id, { page, perPage, isRead })
  return respond.paginated(res, result.data, result.meta)
}

// ─── GET /api/notifications/unread-count ─────────────────────
export async function getUnreadCountHandler(req, res) {
  const count = await getUnreadCount(req.user.id)
  return respond.success(res, { count })
}

// ─── PATCH /api/notifications/:id/read ───────────────────────
export async function markAsReadHandler(req, res) {
  const result = await markAsRead(req.params.id, req.user.id)
  if (result.error === 'NOT_FOUND') return respond.notFound(res)
  return respond.success(res, result.notification, 'Notification marked as read.')
}

// ─── POST /api/notifications/mark-all-read ────────────────────
export async function markAllAsReadHandler(req, res) {
  const result = await markAllAsRead(req.user.id)
  return respond.success(res, { count: result.count }, `${result.count} notification(s) marked as read.`)
}

// ─── DELETE /api/notifications/:id ───────────────────────────
export async function deleteNotificationHandler(req, res) {
  const result = await deleteNotification(req.params.id, req.user.id)
  if (result.error === 'NOT_FOUND') return respond.notFound(res)
  return respond.success(res, null, 'Notification deleted.')
}
