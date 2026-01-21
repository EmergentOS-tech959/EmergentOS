import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { inngest } from '@/lib/inngest';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { Database } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// Maximum time to wait for Inngest to complete (120 seconds for large syncs)
const MAX_POLL_TIME_MS = 120_000;
const POLL_INTERVAL_MS = 500;

/**
 * Poll sync_status until complete or timeout
 */
async function waitForSyncCompletion(
  supa: SupabaseClient,
  userId: string,
  startTime: number
): Promise<{ completed: boolean; error?: string }> {
  const deadline = startTime + MAX_POLL_TIME_MS;

  while (Date.now() < deadline) {
    const { data: status } = await supa
      .from('sync_status')
      .select('status, error_message, current_provider')
      .eq('user_id', userId)
      .maybeSingle();

    // Completed
    if (status?.status === 'complete') {
      return { completed: true };
    }

    // Error
    if (status?.status === 'error') {
      return { completed: false, error: status.error_message || 'Sync failed' };
    }

    // Still in progress - wait
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  // Timeout
  return { completed: false, error: 'Sync timeout - still processing in background' };
}

/**
 * POST /api/integrations/calendar/sync
 * Triggers Calendar sync via Inngest and waits for completion
 * 
 * Benefits of Inngest:
 * - Automatic retries (3x) with exponential backoff
 * - Long-running execution (up to 2 hours)
 * - Full observability in Inngest dashboard
 * - Reliable DLP, embedding, and calendar analysis
 */
export async function POST(req: Request) {
  let authedUserId: string | null = null;
  try {
    const { userId } = await auth();
    authedUserId = userId || null;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    type ConnectionRow = Database['public']['Tables']['connections']['Row'];
    const supa = supabaseAdmin as unknown as SupabaseClient;

    // Parse trigger from request body (default to 'manual')
    let trigger: 'connect' | 'manual' | 'auto' = 'manual';
    try {
      const body = await req.json();
      if (body.trigger === 'auto') trigger = 'auto';
      if (body.trigger === 'connect') trigger = 'connect';
    } catch {
      // No body or invalid JSON - use default
    }

    // Find calendar connection
    const { data: primaryConnection, error: connError } = await supa
      .from('connections')
      .select('connection_id, last_sync_at, metadata')
      .eq('user_id', userId)
      .eq('provider', 'calendar')
      .maybeSingle<Pick<ConnectionRow, 'connection_id'> & { last_sync_at?: string; metadata?: unknown }>();

    if (connError) {
      console.error('Failed to fetch calendar connection', connError);
      return NextResponse.json({ error: 'Unable to find calendar connection' }, { status: 500 });
    }

    let connectionId: string | null = primaryConnection?.connection_id || null;
    const initialLastSyncAt = primaryConnection?.last_sync_at;
    const connMetadata = (primaryConnection?.metadata || {}) as { syncToken?: string };
    const hasSyncToken = !!connMetadata.syncToken;

    // Fallback 1: legacy rows
    if (!connectionId) {
      const { data: metaConnection } = await supa
        .from('connections')
        .select('connection_id')
        .eq('provider', 'calendar')
        .contains('metadata', { clerk_user_id: userId })
        .maybeSingle<Pick<ConnectionRow, 'connection_id'>>();
      connectionId = metaConnection?.connection_id || null;
    }

    // Fallback 2: sole connected calendar
    if (!connectionId) {
      const { data: allConnections } = await supa
        .from('connections')
        .select('connection_id,user_id')
        .eq('provider', 'calendar')
        .eq('status', 'connected');

      if (Array.isArray(allConnections) && allConnections.length === 1) {
        connectionId = allConnections[0]?.connection_id || null;
      }
    }

    if (!connectionId) {
      return NextResponse.json({
        success: true,
        eventsSynced: 0,
        warning: 'Calendar not connected.',
        dataChanged: false,
      });
    }

    // Track initial event count to detect changes
    const { count: initialEventCount } = await supa
      .from('calendar_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    console.log(`[Calendar Sync API] Triggering Inngest sync for user ${userId}, trigger: ${trigger}`);
    const startTime = Date.now();

    // Send event to Inngest - it handles everything:
    // - Fetch events with pagination
    // - Delta sync using syncToken
    // - DLP scanning
    // - Database persistence
    // - Conflict detection
    // - Calendar analysis
    // - Embedding generation
    await inngest.send({
      name: 'calendar/sync.requested',
      data: {
        userId,
        connectionId,
        trigger,
        timestamp: new Date().toISOString(),
      },
    });

    // Wait for Inngest to complete
    const pollResult = await waitForSyncCompletion(supa, userId, startTime);

    if (!pollResult.completed) {
      // Sync still in progress or errored
      if (pollResult.error?.includes('timeout')) {
        console.log(`[Calendar Sync API] Sync still running after ${MAX_POLL_TIME_MS}ms`);
        return NextResponse.json({
          success: true,
          queued: true,
          eventsSynced: 0,
          dataChanged: false,
          warning: 'Sync is running in background. Check back shortly.',
        });
      }

      console.error(`[Calendar Sync API] Sync error:`, pollResult.error);
      return NextResponse.json({
        success: false,
        error: pollResult.error,
        eventsSynced: 0,
        dataChanged: false,
      }, { status: 500 });
    }

    // Sync completed - check results
    const { data: updatedConn } = await supa
      .from('connections')
      .select('last_sync_at')
      .eq('user_id', userId)
      .eq('provider', 'calendar')
      .maybeSingle();

    const { count: finalEventCount } = await supa
      .from('calendar_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Get latest calendar analysis
    const { data: insight } = await supa
      .from('calendar_insights')
      .select('conflicts_count, generated_at')
      .eq('user_id', userId)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const eventsSynced = Math.max(0, (finalEventCount || 0) - (initialEventCount || 0));
    const lastSyncChanged = updatedConn?.last_sync_at !== initialLastSyncAt;
    const dataChanged = eventsSynced > 0 || lastSyncChanged;

    const syncDurationMs = Date.now() - startTime;
    console.log(`[Calendar Sync API] Completed in ${syncDurationMs}ms, synced: ${eventsSynced}, dataChanged: ${dataChanged}`);

    return NextResponse.json({
      success: true,
      eventsSynced,
      fetchedEvents: finalEventCount || 0,
      syncType: hasSyncToken ? 'delta' : 'initial',
      dataChanged,
      analysisResult: insight ? {
        success: true,
        conflictsCount: insight.conflicts_count,
        generatedAt: insight.generated_at,
      } : null,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Calendar sync trigger failed', error);
    if (authedUserId) {
      try {
        const supa = supabaseAdmin as unknown as SupabaseClient;
        await supa
          .from('sync_status')
          .upsert(
            {
              user_id: authedUserId,
              status: 'error',
              current_provider: 'calendar',
              error_message: message,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );
      } catch {
        // best-effort
      }
    }
    return NextResponse.json({ error: 'Failed to trigger calendar sync', details: message }, { status: 500 });
  }
}
