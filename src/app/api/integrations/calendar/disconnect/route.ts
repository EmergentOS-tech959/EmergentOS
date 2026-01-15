import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { Nango } from '@nangohq/node';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const nangoSecretKey = process.env.NANGO_SECRET_KEY;
    if (!nangoSecretKey) {
      return NextResponse.json({ error: 'Nango not configured' }, { status: 500 });
    }

    const supa = supabaseAdmin as unknown as SupabaseClient;

    // Find connectionId by Clerk userId (and legacy metadata mapping)
    const { data: direct } = await supa
      .from('connections')
      .select('connection_id')
      .eq('user_id', userId)
      .eq('provider', 'calendar')
      .maybeSingle();

    const directId = (direct as { connection_id?: string } | null)?.connection_id;
    const { data: meta } = directId
      ? { data: null }
      : await supa
          .from('connections')
          .select('connection_id')
          .eq('provider', 'calendar')
          .contains('metadata', { clerk_user_id: userId })
          .maybeSingle();

    const metaId = (meta as { connection_id?: string } | null)?.connection_id;
    const connectionId = directId || metaId;
    if (!connectionId) {
      // Already disconnected locally
      return NextResponse.json({ success: true });
    }

    const nango = new Nango({ secretKey: nangoSecretKey });
    await nango.deleteConnection('google-calendar', String(connectionId));

    // Remove local mapping + calendar events
    await supa.from('connections').delete().eq('provider', 'calendar').eq('connection_id', String(connectionId));
    await supa.from('calendar_events').delete().eq('user_id', userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Calendar disconnect failed', error);
    return NextResponse.json({ error: 'Failed to disconnect calendar' }, { status: 500 });
  }
}

