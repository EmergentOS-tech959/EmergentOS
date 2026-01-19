import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';

type Provider = 'gmail' | 'calendar' | 'drive';

type ConnectionRow = {
  provider?: string;
  status?: string | null;
  last_sync_at?: string | null;
  updated_at?: string | null;
  connection_id?: string | null;
};

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supa = supabaseAdmin as unknown as SupabaseClient;
  const { data, error } = await supa
    .from('connections')
    .select('provider,status,last_sync_at,updated_at,connection_id')
    .or(`user_id.eq.${userId},metadata->>clerk_user_id.eq.${userId}`)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Failed to load connections', error);
    return NextResponse.json({ error: 'Failed to load connections' }, { status: 500 });
  }

  const defaults: Record<Provider, { status: 'connected' | 'disconnected' | 'error'; lastSyncAt: string | null }> = {
    gmail: { status: 'disconnected', lastSyncAt: null },
    calendar: { status: 'disconnected', lastSyncAt: null },
    drive: { status: 'disconnected', lastSyncAt: null },
  };

  // DEBUG: Log raw data from database
  console.log('[/api/connections] Raw data from DB:', JSON.stringify(data));
  
  const seen = new Set<Provider>();
  for (const row of (data || []) as unknown as ConnectionRow[]) {
    const p = row.provider as Provider | undefined;
    if (!p || !(p in defaults)) continue;
    if (seen.has(p)) continue; // keep most-recent row per provider
    seen.add(p);
    const s = row.status === 'connected' ? 'connected' : row.status === 'error' ? 'error' : 'disconnected';
    defaults[p] = { status: s, lastSyncAt: row.last_sync_at ?? null };
  }

  // DEBUG: Log final result
  console.log('[/api/connections] Returning:', JSON.stringify(defaults));
  
  return NextResponse.json({ connections: defaults });
}

