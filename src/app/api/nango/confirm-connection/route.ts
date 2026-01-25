/**
 * POST /api/nango/confirm-connection
 * 
 * Fallback endpoint to confirm OAuth connection after nango.auth() completes.
 * This handles cases where the Nango webhook doesn't fire.
 * 
 * Flow:
 * 1. Receives provider from frontend after successful OAuth
 * 2. Queries Nango to verify connection exists
 * 3. Creates/updates connection in Supabase (idempotent)
 * 4. Creates sync_job with trigger='connect'
 * 5. Dispatches Inngest event to start sync
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { nango, PROVIDER_CONFIG_KEYS, ProviderKey } from '@/lib/nango';
import { supabase } from '@/lib/supabase';
import { inngest } from '@/lib/inngest';

export async function POST(request: Request) {
  try {
    // 1. Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse request body
    const body = await request.json().catch(() => ({}));
    const { provider } = body as { provider?: string };

    if (!provider || !['gmail', 'calendar', 'drive'].includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider. Must be gmail, calendar, or drive.' },
        { status: 400 }
      );
    }

    const providerConfigKey = PROVIDER_CONFIG_KEYS[provider as ProviderKey];

    console.log(`[Confirm Connection] Confirming ${provider} for user ${userId}`);

    // 3. Query Nango to verify the connection exists
    // IMPORTANT: When using Connect Session tokens, Nango AUTO-GENERATES the connection_id
    // It does NOT use end_user.id as connection_id. We must list all connections and filter.
    let nangoConnectionId: string;
    try {
      console.log(`[Confirm Connection] Listing Nango connections to find ${providerConfigKey} for end_user.id=${userId}`);
      
      // List all connections and filter by provider and end_user.id
      const connections = await nango.listConnections();
      
      console.log(`[Confirm Connection] Total connections in Nango: ${connections.connections.length}`);
      
      // Find the connection for this user and provider
      // When using session tokens, end_user.id contains our userId
      const matchingConnection = connections.connections.find(
        (conn) => 
          conn.provider_config_key === providerConfigKey &&
          conn.end_user?.id === userId
      );

      if (!matchingConnection) {
        console.log(`[Confirm Connection] No matching connection found. Searching for:`);
        console.log(`  - provider_config_key: ${providerConfigKey}`);
        console.log(`  - end_user.id: ${userId}`);
        
        // Log first few connections to help debug
        const sampleConnections = connections.connections.slice(0, 5).map(c => ({
          connection_id: c.connection_id,
          provider_config_key: c.provider_config_key,
          end_user_id: c.end_user?.id
        }));
        console.log(`[Confirm Connection] Sample connections:`, JSON.stringify(sampleConnections, null, 2));
        
        return NextResponse.json(
          { error: 'Connection not found in Nango. Please try connecting again.' },
          { status: 404 }
        );
      }

      nangoConnectionId = matchingConnection.connection_id;
      
      console.log(`[Confirm Connection] Found Nango connection:`, {
        connectionId: nangoConnectionId,
        provider_config_key: matchingConnection.provider_config_key,
        end_user_id: matchingConnection.end_user?.id
      });

    } catch (nangoError: unknown) {
      console.error('[Confirm Connection] Error querying Nango:', nangoError);
      return NextResponse.json(
        { error: 'Failed to verify connection with Nango' },
        { status: 500 }
      );
    }

    // 4. Check if connection already exists in Supabase
    const { data: existingConnection } = await supabase
      .from('connections')
      .select('id, last_sync_at, status')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single();

    // If connection exists and sync already started/completed, don't duplicate
    if (existingConnection && existingConnection.status === 'connected') {
      console.log(`[Confirm Connection] Connection already exists in Supabase:`, existingConnection);
      
      // Check if there's already a pending sync job
      const { data: existingJob } = await supabase
        .from('sync_jobs')
        .select('id, status')
        .eq('user_id', userId)
        .eq('provider', provider)
        .eq('trigger', 'connect')
        .in('status', ['pending', 'fetching', 'securing', 'persisting', 'analyzing', 'embedding'])
        .order('started_at', { ascending: false })
        .limit(1)
        .single();

      if (existingJob) {
        console.log(`[Confirm Connection] Sync job already in progress:`, existingJob);
        return NextResponse.json({
          success: true,
          message: 'Connection exists and sync is in progress',
          connectionId: existingConnection.id,
          syncJobId: existingJob.id,
          alreadyExists: true
        });
      }

      // Connection exists but no sync job - might need to create one
      if (!existingConnection.last_sync_at) {
        console.log(`[Confirm Connection] Connection exists but no sync completed, creating sync job`);
        // Fall through to create sync job
      } else {
        return NextResponse.json({
          success: true,
          message: 'Connection already established and synced',
          connectionId: existingConnection.id,
          lastSyncAt: existingConnection.last_sync_at,
          alreadyExists: true
        });
      }
    }

    // 5. UPSERT connection with last_sync_at = NULL (CRITICAL!)
    const { data: connection, error: connectionError } = await supabase
      .from('connections')
      .upsert({
        user_id: userId,
        provider: provider,
        connection_id: nangoConnectionId,
        status: 'connected',
        last_sync_at: null,  // CRITICAL: NULL for initial sync
        metadata: {
          clerk_user_id: userId,
          nango_provider_config_key: providerConfigKey,
          confirmed_via: 'fallback_api'  // Track that this came from fallback
        },
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,provider'
      })
      .select()
      .single();

    if (connectionError) {
      console.error('[Confirm Connection] Error upserting connection:', connectionError);
      return NextResponse.json(
        { error: 'Failed to create connection record' },
        { status: 500 }
      );
    }

    console.log(`[Confirm Connection] Created/updated connection:`, connection);

    // 6. Create sync_job with trigger='connect'
    const jobId = crypto.randomUUID();
    const idempotencyKey = `connect-${userId}-${provider}-${Date.now()}`;

    const { error: jobError } = await supabase
      .from('sync_jobs')
      .insert({
        id: jobId,
        user_id: userId,
        provider: provider,
        trigger: 'connect',
        idempotency_key: idempotencyKey,
        status: 'pending',
        started_at: new Date().toISOString()
      });

    if (jobError) {
      console.error('[Confirm Connection] Error creating sync job:', jobError);
      return NextResponse.json(
        { error: 'Failed to create sync job' },
        { status: 500 }
      );
    }

    console.log(`[Confirm Connection] Created sync job: ${jobId}`);

    // 7. Dispatch Inngest event to start sync
    await inngest.send({
      name: `${provider}/sync.requested`,
      data: {
        userId,
        connectionId: connection.id,
        trigger: 'connect',
        idempotencyKey,
        jobId
      }
    });

    console.log(`[Confirm Connection] Dispatched Inngest event for ${provider}/sync.requested`);

    return NextResponse.json({
      success: true,
      connectionId: connection.id,
      syncJobId: jobId,
      message: 'Connection confirmed and sync initiated'
    });

  } catch (error) {
    console.error('[Confirm Connection] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
