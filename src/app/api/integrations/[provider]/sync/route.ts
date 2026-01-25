/**
 * EmergentOS - Sync Trigger API Route
 * 
 * POST /api/integrations/[provider]/sync
 * Triggers a sync for the specified provider.
 * Per Section 8.1.
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { inngest } from '@/lib/inngest';
import { SYNC_POLL_INTERVAL_MS, SYNC_POLL_TIMEOUT_MS } from '@/lib/constants';

type Provider = 'gmail' | 'calendar' | 'drive';

const VALID_PROVIDERS: Provider[] = ['gmail', 'calendar', 'drive'];

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

    // 3. Parse trigger from body
    const body = await request.json().catch(() => ({}));
    const trigger = body.trigger || 'manual';

    // 4. Check connection exists
    const { data: connection } = await supabase
      .from('connections')
      .select('id, connection_id, last_sync_at, metadata')
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('status', 'connected')
      .single();

    if (!connection) {
      return NextResponse.json({
        success: true,
        warning: 'Not connected',
        dataChanged: false,
        itemsSynced: 0,
      });
    }

    // 5. Create sync job and send Inngest event
    const jobId = crypto.randomUUID();
    const idempotencyKey = `${trigger}-${userId}-${provider}-${Date.now()}`;

    await supabase.from('sync_jobs').insert({
      id: jobId,
      user_id: userId,
      provider,
      trigger,
      idempotency_key: idempotencyKey,
      status: 'pending',
    });

    await inngest.send({
      name: `${provider}/sync.requested`,
      data: {
        userId,
        connectionId: connection.id,
        trigger,
        idempotencyKey,
        jobId,
      },
    });

    // 6. Poll for completion (max 120s)
    const startTime = Date.now();

    while (Date.now() - startTime < SYNC_POLL_TIMEOUT_MS) {
      const { data: job } = await supabase
        .from('sync_jobs')
        .select(
          'status, items_inserted, items_updated, items_deleted, time_changed, error_message'
        )
        .eq('id', jobId)
        .single();

      if (job?.status === 'complete') {
        const itemsSynced =
          (job.items_inserted || 0) + (job.items_updated || 0);
        const dataChanged =
          itemsSynced > 0 || (job.items_deleted || 0) > 0;

        return NextResponse.json({
          success: true,
          itemsSynced,
          itemsDeleted: job.items_deleted || 0,
          syncType: connection.last_sync_at ? 'delta' : 'initial',
          dataChanged,
          timeChanged: job.time_changed || false, // Calendar only
        });
      }

      if (job?.status === 'error') {
        return NextResponse.json(
          { success: false, error: job.error_message },
          { status: 500 }
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, SYNC_POLL_INTERVAL_MS)
      );
    }

    // 7. Timeout - still processing
    return NextResponse.json({
      success: true,
      queued: true,
      dataChanged: false,
      warning: 'Sync is still processing in the background.',
    });
  } catch (error) {
    console.error('[Sync API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
