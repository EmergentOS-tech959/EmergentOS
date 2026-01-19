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

    const { data: direct } = await supa
      .from('connections')
      .select('connection_id')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .maybeSingle();

    const directId = (direct as { connection_id?: string } | null)?.connection_id;
    const { data: meta } = directId
      ? { data: null }
      : await supa
          .from('connections')
          .select('connection_id')
          .eq('provider', 'gmail')
          .contains('metadata', { clerk_user_id: userId })
          .maybeSingle();

    const metaId = (meta as { connection_id?: string } | null)?.connection_id;
    const connectionId = directId || metaId;
    if (!connectionId) {
      return NextResponse.json({ success: true });
    }

    const nango = new Nango({ secretKey: nangoSecretKey });
    await nango.deleteConnection('google-mail', String(connectionId));

    await supa.from('connections').delete().eq('provider', 'gmail').eq('connection_id', String(connectionId));
    await supa.from('emails').delete().eq('user_id', userId);
    // Also delete embeddings from this source
    await supa.from('embeddings').delete().eq('user_id', userId).eq('source_type', 'gmail');
    
    // CRITICAL: Delete today's briefing so stale Gmail data isn't shown
    // A new briefing will be regenerated without Gmail data
    const today = new Date().toISOString().split('T')[0];
    await supa.from('briefings').delete().eq('user_id', userId).eq('date', today);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Gmail disconnect failed', error);
    return NextResponse.json({ error: 'Failed to disconnect Gmail' }, { status: 500 });
  }
}

