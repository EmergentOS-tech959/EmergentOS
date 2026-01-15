import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = supabaseAdmin;
  const { data, error } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('user_id', userId)
    .eq('has_conflict', true)
    .order('start_time', { ascending: true });

  if (error) {
    console.error('Error fetching conflicts', error);
    return NextResponse.json({ error: 'Failed to fetch conflicts' }, { status: 500 });
  }

  return NextResponse.json({ conflicts: data || [] });
}
