import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';

function isIsoDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ date: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { date } = await params;
  if (!isIsoDate(date)) {
    return NextResponse.json({ error: 'Invalid date format (expected YYYY-MM-DD)' }, { status: 400 });
  }

  const supa = supabaseAdmin as unknown as SupabaseClient;
  const { data, error } = await supa
    .from('briefings')
    .select('*')
    .eq('user_id', userId)
    .eq('briefing_date', date)
    .maybeSingle();

  if (error) {
    console.error('Briefing fetch error', error);
    return NextResponse.json({ error: 'Failed to fetch briefing' }, { status: 500 });
  }

  return NextResponse.json({ briefing: data || null });
}

