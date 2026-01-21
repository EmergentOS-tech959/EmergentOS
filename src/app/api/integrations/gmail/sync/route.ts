import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { inngest } from '@/lib/inngest';
import { supabaseAdmin } from '@/lib/supabase-server';
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
 * POST /api/integrations/gmail/sync
 * Triggers Gmail sync via Inngest and waits for completion
 * 
 * Benefits of Inngest:
 * - Automatic retries (3x) with exponential backoff
 * - Long-running execution (up to 2 hours)
 * - Full observability in Inngest dashboard
 * - Reliable DLP and embedding processing
 */
export async function POST(req: Request) {
  let authedUserId: string | null = null;
  try {
    const { userId } = await auth();
    authedUserId = userId || null;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

    // Find connectionId by Clerk userId
    const { data: direct } = await supa
      .from('connections')
      .select('connection_id, last_sync_at')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .maybeSingle();

    const directData = direct as { connection_id?: string; last_sync_at?: string } | null;
    const directId = directData?.connection_id;
    const initialLastSyncAt = directData?.last_sync_at;

    const { data: meta } = directId
      ? { data: null }
      : await supa
          .from('connections')
          .select('connection_id, last_sync_at')
          .eq('provider', 'gmail')
          .contains('metadata', { clerk_user_id: userId })
          .maybeSingle();

    const metaData = meta as { connection_id?: string; last_sync_at?: string } | null;
    const connectionId = directId || metaData?.connection_id || null;

    if (!connectionId) {
      return NextResponse.json({
        success: true,
        warning: 'Gmail not connected',
        emailsProcessed: 0,
        dataChanged: false,
      });
    }

    // Track initial email count to detect changes
    const { count: initialEmailCount } = await supa
      .from('emails')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    console.log(`[Gmail Sync API] Triggering Inngest sync for user ${userId}, trigger: ${trigger}`);
    const startTime = Date.now();

    // Send event to Inngest - it handles everything:
    // - Fetch emails with pagination
    // - DLP scanning with batching and retries
    // - Database persistence
    // - Embedding generation
    await inngest.send({
      name: 'gmail/sync.requested',
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
        // Not a failure - just taking longer
        console.log(`[Gmail Sync API] Sync still running after ${MAX_POLL_TIME_MS}ms`);
        return NextResponse.json({
          success: true,
          queued: true,
          emailsProcessed: 0,
          dataChanged: false,
          warning: 'Sync is running in background. Check back shortly.',
        });
      }

      // Actual error
      console.error(`[Gmail Sync API] Sync error:`, pollResult.error);
      return NextResponse.json({
        success: false,
        error: pollResult.error,
        emailsProcessed: 0,
        dataChanged: false,
      }, { status: 500 });
    }

    // Sync completed - check results
    const { data: updatedConn } = await supa
      .from('connections')
      .select('last_sync_at')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .maybeSingle();

    const { count: finalEmailCount } = await supa
      .from('emails')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const emailsProcessed = Math.max(0, (finalEmailCount || 0) - (initialEmailCount || 0));
    const lastSyncChanged = updatedConn?.last_sync_at !== initialLastSyncAt;
    const dataChanged = emailsProcessed > 0 || lastSyncChanged;

    const syncDurationMs = Date.now() - startTime;
    console.log(`[Gmail Sync API] Completed in ${syncDurationMs}ms, processed: ${emailsProcessed}, dataChanged: ${dataChanged}`);

    return NextResponse.json({
      success: true,
      emailsProcessed,
      dataChanged,
      syncType: initialLastSyncAt ? 'delta' : 'initial',
      embeddingStatus: { triggered: true, method: 'inngest' },
    });

  } catch (error) {
    console.error('[Gmail Sync API] Error:', error);

    // Update status to error
    if (authedUserId) {
      const supa = supabaseAdmin as unknown as SupabaseClient;
      await supa
        .from('sync_status')
        .upsert(
          {
            user_id: authedUserId,
            status: 'error',
            current_provider: 'gmail',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Gmail sync failed' },
      { status: 500 }
    );
  }
}
