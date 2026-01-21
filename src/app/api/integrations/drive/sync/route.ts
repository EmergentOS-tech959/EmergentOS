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
 * POST /api/integrations/drive/sync
 * Triggers Drive sync via Inngest and waits for completion
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
      .eq('provider', 'drive')
      .maybeSingle();

    const directData = direct as { connection_id?: string; last_sync_at?: string } | null;
    const directId = directData?.connection_id;
    const initialLastSyncAt = directData?.last_sync_at;

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

    if (!connectionId) {
      return NextResponse.json({
        success: true,
        documentsSynced: 0,
        warning: 'Drive not connected.',
        dataChanged: false,
      });
    }

    // Track initial document count to detect changes
    const { count: initialDocCount } = await supa
      .from('drive_documents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    console.log(`[Drive Sync API] Triggering Inngest sync for user ${userId}, trigger: ${trigger}`);
    const startTime = Date.now();

    // Send event to Inngest - it handles everything:
    // - Fetch files with pagination
    // - DLP scanning
    // - Database persistence
    // - Embedding generation
    await inngest.send({
      name: 'drive/sync.requested',
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
        console.log(`[Drive Sync API] Sync still running after ${MAX_POLL_TIME_MS}ms`);
        return NextResponse.json({
          success: true,
          queued: true,
          documentsSynced: 0,
          dataChanged: false,
          warning: 'Sync is running in background. Check back shortly.',
        });
      }

      console.error(`[Drive Sync API] Sync error:`, pollResult.error);
      return NextResponse.json({
        success: false,
        error: pollResult.error,
        documentsSynced: 0,
        dataChanged: false,
      }, { status: 500 });
    }

    // Sync completed - check results
    const { data: updatedConn } = await supa
      .from('connections')
      .select('last_sync_at')
      .eq('user_id', userId)
      .eq('provider', 'drive')
      .maybeSingle();

    const { count: finalDocCount } = await supa
      .from('drive_documents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const documentsSynced = Math.max(0, (finalDocCount || 0) - (initialDocCount || 0));
    const lastSyncChanged = updatedConn?.last_sync_at !== initialLastSyncAt;
    const dataChanged = documentsSynced > 0 || lastSyncChanged;

    const syncDurationMs = Date.now() - startTime;
    console.log(`[Drive Sync API] Completed in ${syncDurationMs}ms, synced: ${documentsSynced}, dataChanged: ${dataChanged}`);

    return NextResponse.json({
      success: true,
      documentsSynced,
      syncType: initialLastSyncAt ? 'delta' : 'initial',
      dataChanged,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Drive sync trigger failed', error);
    if (authedUserId) {
      try {
        const supa = supabaseAdmin as unknown as SupabaseClient;
        await supa
          .from('sync_status')
          .upsert(
            {
              user_id: authedUserId,
              status: 'error',
              current_provider: 'drive',
              error_message: message,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );
      } catch {
        // best-effort
      }
    }
    return NextResponse.json({ error: 'Failed to trigger drive sync', details: message }, { status: 500 });
  }
}
