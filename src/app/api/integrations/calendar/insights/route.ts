import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supa = supabaseAdmin as unknown as SupabaseClient;
  const { data, error } = await supa
    .from('calendar_insights')
    .select('*')
    .eq('user_id', userId)
    .order('analysis_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: 'Failed to fetch insights' }, { status: 500 });
  return NextResponse.json({ insight: data || null });
}

