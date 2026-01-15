import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types';

/**
 * Supabase admin client for SERVER-SIDE operations ONLY
 * Uses the service role key - bypasses RLS
 * Only import this in API routes and server functions (Inngest, etc.)
 */
export const supabaseAdmin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Convenience helper to keep parity with server/client callers
export function supabaseServerClient() {
  return supabaseAdmin;
}
