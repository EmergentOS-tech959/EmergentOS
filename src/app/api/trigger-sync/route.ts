import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { inngest } from '@/lib/inngest';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * POST /api/trigger-sync
 * Manual trigger endpoint for testing the email sync pipeline
 * 
 * This bypasses the Nango webhook and directly triggers the Inngest function.
 * Useful for:
 * - Local development without ngrok
 * - Testing the Inngest → Supabase flow
 * - Debugging
 * 
 * In production, this should be removed or protected with admin auth.
 */
export async function POST() {
  try {
    // Get the authenticated user from Clerk
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supa = supabaseAdmin as unknown as SupabaseClient;

    // Resolve the real Nango connection_id for Gmail (required for Nango proxy calls)
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
    const connectionId = directId || metaId || null;

    if (!connectionId) {
      return NextResponse.json({
        success: true,
        warning: 'Gmail not connected. Please connect Gmail first so we have a valid Nango connection_id.',
      });
    }

    // Update sync status to indicate fetching
    await supa
      .from('sync_status')
      .upsert(
        {
          user_id: userId,
          status: 'fetching',
          current_provider: 'gmail',
          error_message: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    // Trigger the Inngest function directly
    // NOTE: Do NOT set last_sync_at or sync_status here!
    // The Inngest function will set them AFTER successful data sync.
    // Setting last_sync_at here causes delta sync to find 0 emails.
    // Setting sync_status: complete here is a lie - sync hasn't happened yet!
    await inngest.send({
      name: 'gmail/connection.established',
      data: {
        userId: userId,
        connectionId,
        providerConfigKey: 'google-mail',
        timestamp: new Date().toISOString(),
        trigger: 'manual', // Flag to indicate this was manually triggered
      },
    });

    // Return immediately - the Inngest function will:
    // 1. Fetch emails (initial sync: 7 days, delta sync: since last_sync_at)
    // 2. Run DLP scan
    // 3. Store emails in database
    // 4. Update last_sync_at AFTER successful sync
    // 5. Update sync_status to 'complete'
    return NextResponse.json({
      success: true,
      message: 'Gmail sync initiated. Data will be available shortly.',
      userId: userId,
      connectionId,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Manual trigger error:', error);
    return NextResponse.json(
      { error: 'Failed to trigger sync' },
      { status: 500 }
    );
  }
}

