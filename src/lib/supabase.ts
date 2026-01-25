/**
 * EmergentOS - Supabase Client
 * 
 * Server-side Supabase client using service role key.
 * IMPORTANT: Only use this in API routes and server components.
 */

import { createClient } from '@supabase/supabase-js';

// Validate required environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
}

if (!supabaseServiceKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
}

/**
 * Server-side Supabase client with service role key.
 * Bypasses RLS - use only in API routes with proper user_id filtering.
 */
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * Create a Supabase client for a specific user context.
 * Still uses service role but helps organize user-scoped queries.
 */
export function getSupabaseClient() {
  return supabase;
}

export default supabase;
