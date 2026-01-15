import { NextRequest, NextResponse } from 'next/server';
import { Nango } from '@nangohq/node';
import { inngest } from '@/lib/inngest';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { Database } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * POST /api/nango/webhook
 * Receives webhook events from Nango
 * 
 * Since Nango generates its own connection IDs, we need to:
 * 1. Get the connectionId from the webhook
 * 2. Query Nango to get the end_user.id (our Clerk user ID)
 * 3. Use Clerk user ID for Supabase, connectionId for Nango API calls
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    
    console.log('=== NANGO WEBHOOK FULL PAYLOAD ===');
    console.log(JSON.stringify(payload, null, 2));
    console.log('=== END PAYLOAD ===');

    // Handle auth webhook (new connection established)
    if (payload.type === 'auth') {
      const { connectionId, providerConfigKey, provider } = payload;
      
      // Try to get Clerk userId from end_user.id (this is what we set in createConnectSession)
      let clerkUserId = 
        payload.endUser?.id || 
        payload.end_user?.id || 
        payload.data?.endUser?.id ||
        payload.data?.end_user?.id;
      
      console.log('=== EXTRACTED FROM PAYLOAD ===');
      console.log('connectionId:', connectionId);
      console.log('clerkUserId from payload:', clerkUserId);
      
      // If not in payload, query Nango to get the connection details (authoritative)
      if (!clerkUserId && connectionId && process.env.NANGO_SECRET_KEY) {
        try {
          console.log('Fetching connection details from Nango...');
          const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY });
          const connection = await nango.getConnection(
            providerConfigKey || 'google-mail',
            connectionId
          );
          
          console.log('Nango connection details:', JSON.stringify(connection, null, 2));
          
          // The end_user.id should be in the connection metadata
          const conn = connection as Record<string, unknown>;
          const endUser = conn.end_user as Record<string, unknown> | undefined;
          const endUserAlt = conn.endUser as Record<string, unknown> | undefined;
          const metadata = conn.metadata as Record<string, unknown> | undefined;
          clerkUserId = endUser?.id as string | undefined || 
                        endUserAlt?.id as string | undefined ||
                        metadata?.clerk_user_id as string | undefined;
          
          console.log('clerkUserId from Nango API:', clerkUserId);
        } catch (nangoError) {
          console.error('Failed to fetch connection from Nango:', nangoError);
        }
      }
      
      // If we still don't have a Clerk userId, we cannot safely associate the connection.
      if (!clerkUserId) {
        console.error('Unable to determine Clerk userId for connection; refusing to persist mapping.', {
          connectionId,
          providerConfigKey,
          provider,
        });
        return NextResponse.json({ received: true, error: 'Missing end_user.id' });
      }
      const finalUserId = clerkUserId;
      
      console.log('=== FINAL IDs ===');
      console.log('finalUserId (for Supabase):', finalUserId);
      console.log('connectionId (for Nango):', connectionId);
      console.log('===================');
      
      const providerKey = providerConfigKey || provider;

      const upsertConnection = async (providerName: string) => {
        type ConnectionInsert = Database['public']['Tables']['connections']['Insert'];
        const payload: ConnectionInsert = {
          user_id: String(finalUserId),
          provider: providerName,
          connection_id: String(connectionId),
          status: 'connected',
          metadata: { clerk_user_id: String(finalUserId) },
          updated_at: new Date().toISOString(),
        };

        const connectionsClient = supabaseAdmin as SupabaseClient<Database>;
        const tableName: keyof Database['public']['Tables'] = 'connections';
        // Also repair any legacy row that used a non-Clerk user_id for this same connection_id.
        await connectionsClient
          .from(tableName)
          // Type casting to satisfy Supabase typed client for custom schema
          .update({ user_id: String(finalUserId), metadata: { clerk_user_id: String(finalUserId) } } as unknown as never)
          .eq('connection_id', String(connectionId))
          .eq('provider', providerName);
        const { error: connError } = await connectionsClient
          .from(tableName)
          // Type casting to satisfy Supabase typed client for custom schema
          .upsert(payload as unknown as never, { onConflict: 'user_id,provider' });
        if (connError) {
          console.error(`Failed to upsert connection for ${providerName}`, connError);
        }
      };

      if (providerKey === 'google-mail') {
        await upsertConnection('gmail');
        console.log(`Gmail connected - Clerk userId: ${finalUserId}, Nango connectionId: ${connectionId}`);
        await inngest.send({
          name: 'gmail/connection.established',
          data: {
            userId: finalUserId,
            connectionId,
            providerConfigKey: providerKey,
            timestamp: new Date().toISOString(),
          },
        });
        console.log('Inngest event sent: gmail/connection.established');
      }

      if (providerKey === 'google-calendar') {
        await upsertConnection('calendar');
        console.log(`Calendar connected - Clerk userId: ${finalUserId}, Nango connectionId: ${connectionId}`);
        await inngest.send({
          name: 'calendar/connection.established',
          data: {
            userId: finalUserId,
            connectionId,
            providerConfigKey: providerKey,
            timestamp: new Date().toISOString(),
          },
        });
        console.log('Inngest event sent: calendar/connection.established');
      }

      if (providerKey === 'google-drive') {
        await upsertConnection('drive');
        console.log(`Drive connected - Clerk userId: ${finalUserId}, Nango connectionId: ${connectionId}`);
        await inngest.send({
          name: 'drive/connection.established',
          data: {
            userId: finalUserId,
            connectionId,
            providerConfigKey: providerKey,
            timestamp: new Date().toISOString(),
          },
        });
        console.log('Inngest event sent: drive/connection.established');
      }
    }

    // Handle sync webhook (data sync completed)
    if (payload.type === 'sync') {
      console.log('Sync webhook received (not handled in Phase 0)');
    }

    // Handle forward webhook (new data from integration)
    if (payload.type === 'forward') {
      console.log('Forward webhook received (not handled in Phase 0)');
    }

    return NextResponse.json({ 
      received: true,
      type: payload.type,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Nango webhook error:', error);
    
    // Still return 200 to prevent Nango from retrying
    return NextResponse.json({ 
      received: true, 
      error: 'Processing error logged' 
    });
  }
}

// Also handle GET for webhook verification
export async function GET() {
  return NextResponse.json({ 
    status: 'Nango webhook endpoint active',
    timestamp: new Date().toISOString(),
  });
}
