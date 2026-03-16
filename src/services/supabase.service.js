import { createClient } from '@supabase/supabase-js'

if (!process.env.SUPABASE_URL) throw new Error('Missing SUPABASE_URL')
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

/**
 * Server-side Supabase client.
 * Uses SERVICE ROLE key — bypasses RLS intentionally.
 * Our API middleware (auth + isolation) is the primary access control layer.
 * RLS is the secondary safety net at the DB level.
 *
 * NEVER expose this client or its key to the frontend or mobile app.
 */
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false }
  }
)
