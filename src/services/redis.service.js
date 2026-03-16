// In-memory session store — no Redis/Upstash required.
// Sessions are lost on server restart (acceptable for local/dev use).

const store  = new Map()   // key → value
const expiry = new Map()   // key → expiry timestamp (ms)

function isExpired(k) {
  const exp = expiry.get(k)
  if (exp === undefined) return false
  if (Date.now() > exp) { store.delete(k); expiry.delete(k); return true }
  return false
}

const redis = {
  get:     async (k)        => { if (isExpired(k)) return null; return store.get(k) ?? null },
  set:     async (k, v)     => { store.set(k, v); return 'OK' },
  del:     async (k)        => { store.delete(k); expiry.delete(k); return 1 },
  incr:    async (k)        => { if (isExpired(k)) store.delete(k); const n = (store.get(k) ?? 0) + 1; store.set(k, n); return n },
  expire:  async (k, ttl)   => { expiry.set(k, Date.now() + ttl * 1000); return 1 },
  ping:    async ()         => 'PONG',
  disconnect: ()            => {},
}

console.log('[Sessions] Using in-memory store.')

// ─── Session Keys ─────────────────────────────────────────────
const SESSION_KEY = (userId) => `session:${userId}`
const LOCK_KEY    = (email)  => `lock:${email}`
const FAIL_KEY    = (email)  => `fails:${email}`

const WEB_TTL    = parseInt(process.env.WEB_SESSION_TIMEOUT       ?? '30') * 60
const MOBILE_TTL = parseInt(process.env.MOBILE_SESSION_TIMEOUT    ?? '60') * 60
const LOCK_TTL   = parseInt(process.env.LOGIN_LOCKOUT_MINUTES     ?? '15') * 60
const MAX_FAILS  = parseInt(process.env.MAX_FAILED_LOGIN_ATTEMPTS ?? '5')
const DRIVER_INTRANSIT_TTL = 24 * 60 * 60

export const sessionService = {

  async set(userId, token, { isMobile = false, isDriverInTransit = false } = {}) {
    let ttl = isMobile ? MOBILE_TTL : WEB_TTL
    if (isDriverInTransit) ttl = DRIVER_INTRANSIT_TTL
    await redis.set(SESSION_KEY(userId), token)
    await redis.expire(SESSION_KEY(userId), ttl)
    return ttl
  },

  async get(userId) {
    return redis.get(SESSION_KEY(userId))
  },

  async destroy(userId) {
    await redis.del(SESSION_KEY(userId))
  },

  async refresh(userId, { isMobile = false, isDriverInTransit = false } = {}) {
    const token = await redis.get(SESSION_KEY(userId))
    return !!token
  },

  async recordFailedAttempt(email) {
    const key = FAIL_KEY(email)
    const count = await redis.incr(key)
    return count
  },

  async getFailedAttempts(email) {
    const val = await redis.get(FAIL_KEY(email))
    return parseInt(val ?? '0')
  },

  async clearFailedAttempts(email) {
    await redis.del(FAIL_KEY(email))
  },

  async isLocked(email) {
    const val = await redis.get(LOCK_KEY(email))
    return !!val
  },

  async lock(email) {
    await redis.set(LOCK_KEY(email), '1')
    await redis.expire(LOCK_KEY(email), LOCK_TTL)
    await redis.del(FAIL_KEY(email))
  },

  async unlock(email) {
    await redis.del(LOCK_KEY(email))
    await redis.del(FAIL_KEY(email))
  },

  get maxFails() { return MAX_FAILS }
}
