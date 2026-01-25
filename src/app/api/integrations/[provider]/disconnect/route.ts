/**
 * EmergentOS - Disconnect API Route
 * 
 * POST /api/integrations/[provider]/disconnect
 * Removes a provider connection and all associated data.
 * Per Section 6.
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { nango, PROVIDER_CONFIG_KEYS } from '@/lib/nango';
import { getCurrentUTCDate } from '@/lib/time';
import { generateBriefingForUser } from '@/lib/inngest/cron-briefing';

type Provider = 'gmail' | 'calendar' | 'drive';

const VALID_PROVIDERS: Provider[] = ['gmail', 'calendar', 'drive'];

// CRITICAL: Map provider to correct source_type for embeddings deletion
const PROVIDER_SOURCE_TYPE_MAP: Record<Provider, string> = {
  gmail: 'email',     // NOT 'gmail'!
  calendar: 'calendar',
  drive: 'drive',
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    // 1. Extract provider from route params
    const { provider } = await params;

    // Validate provider
    if (!VALID_PROVIDERS.includes(provider as Provider)) {
      return NextResponse.json(
        { error: `Invalid provider: ${provider}` },
        { status: 400 }
      );
    }

    // 2. Auth
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 3. Find connection
    const { data: connection } = await supabase
      .from('connections')
      .select('connection_id')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single();

    // If not found, already disconnected
    if (!connection) {
      return NextResponse.json({ success: true });
    }

    // 4. Delete from Nango (graceful failure)
    try {
      const providerConfigKey = PROVIDER_CONFIG_KEYS[provider as Provider];
      await nango.deleteConnection(providerConfigKey, connection.connection_id);
      console.log(`[Disconnect] Deleted Nango connection for ${provider}`);
    } catch (error) {
      console.warn(`[Disconnect] Nango delete failed:`, error);
      // Continue anyway - don't fail the disconnect for this
    }

    // 5. Delete local data (provider-specific)
    const sourceType = PROVIDER_SOURCE_TYPE_MAP[provider as Provider];

    // Delete connection record
    await supabase
      .from('connections')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider);

    // Delete provider-specific data
    if (provider === 'gmail') {
      await supabase.from('emails').delete().eq('user_id', userId);
    } else if (provider === 'calendar') {
      await supabase.from('calendar_events').delete().eq('user_id', userId);
      await supabase.from('calendar_insights').delete().eq('user_id', userId);
    } else if (provider === 'drive') {
      await supabase.from('drive_documents').delete().eq('user_id', userId);
    }

    // Delete embeddings for this source type
    await supabase
      .from('embeddings')
      .delete()
      .eq('user_id', userId)
      .eq('source_type', sourceType);

    // Delete today's briefing (will be regenerated)
    const todayUTC = getCurrentUTCDate();
    await supabase
      .from('briefings')
      .delete()
      .eq('user_id', userId)
      .eq('briefing_date', todayUTC);

    console.log(`[Disconnect] Deleted all ${provider} data for user ${userId}`);

    // 6. Regenerate briefing with remaining sources
    try {
      await generateBriefingForUser({ userId });
      console.log(`[Disconnect] Regenerated briefing for user ${userId}`);
    } catch (error) {
      console.warn(`[Disconnect] Briefing regeneration failed:`, error);
      // Don't fail disconnect for briefing errors
    }

    // 7. Return success
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Disconnect API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
