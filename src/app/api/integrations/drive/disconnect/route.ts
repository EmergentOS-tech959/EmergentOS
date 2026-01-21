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
      .eq('provider', 'drive')
      .maybeSingle();

    const directId = (direct as { connection_id?: string } | null)?.connection_id;
    const { data: meta } = directId
      ? { data: null }
      : await supa
          .from('connections')
          .select('connection_id')
          .eq('provider', 'drive')
          .contains('metadata', { clerk_user_id: userId })
          .maybeSingle();

    const metaId = (meta as { connection_id?: string } | null)?.connection_id;
    const connectionId = directId || metaId;
    if (!connectionId) return NextResponse.json({ success: true });

    const nango = new Nango({ secretKey: nangoSecretKey });
    await nango.deleteConnection('google-drive', String(connectionId));

    await supa.from('connections').delete().eq('provider', 'drive').eq('connection_id', String(connectionId));
    await supa.from('drive_documents').delete().eq('user_id', userId);
    // Also delete embeddings from this source
    await supa.from('embeddings').delete().eq('user_id', userId).eq('source_type', 'drive');
    
    // CRITICAL: Delete today's briefing so stale Drive data isn't shown
    // Then regenerate a new briefing with remaining connected sources
    const today = new Date().toISOString().split('T')[0];
    await supa.from('briefings').delete().eq('user_id', userId).eq('briefing_date', today);

    // Regenerate briefing with remaining connected sources
    try {
      console.log('[Drive Disconnect] Regenerating briefing without Drive...');
      await generateBriefingForUser({ userId });
      console.log('[Drive Disconnect] Briefing regenerated successfully');
    } catch (briefingErr) {
      console.error('[Drive Disconnect] Briefing regeneration failed:', briefingErr);
      // Don't fail the disconnect if briefing fails
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Drive disconnect failed', error);
    return NextResponse.json({ error: 'Failed to disconnect drive' }, { status: 500 });
  }
}

