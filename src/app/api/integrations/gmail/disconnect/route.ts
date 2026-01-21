import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { Nango } from '@nangohq/node';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateBriefingForUser } from '@/lib/briefing-generator';

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
    // Also delete embeddings from this source (source_type is 'email', not 'gmail')
    await supa.from('embeddings').delete().eq('user_id', userId).eq('source_type', 'email');
    
    // CRITICAL: Delete today's briefing so stale Gmail data isn't shown
    // Then regenerate a new briefing with remaining connected sources
    const today = new Date().toISOString().split('T')[0];
    await supa.from('briefings').delete().eq('user_id', userId).eq('briefing_date', today);

    // Regenerate briefing with remaining connected sources
    try {
      console.log('[Gmail Disconnect] Regenerating briefing without Gmail...');
      await generateBriefingForUser({ userId });
      console.log('[Gmail Disconnect] Briefing regenerated successfully');
    } catch (briefingErr) {
      console.error('[Gmail Disconnect] Briefing regeneration failed:', briefingErr);
      // Don't fail the disconnect if briefing fails
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Gmail disconnect failed', error);
    return NextResponse.json({ error: 'Failed to disconnect Gmail' }, { status: 500 });
  }
}

