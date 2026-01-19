import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { Nango } from '@nangohq/node';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * POST /api/nango/connect
 * Two modes:
 * 1. No body: Creates a Nango connect session token for OAuth
 * 2. Body { provider: string }: Verifies Nango connection and creates DB row if missing
 */
export async function POST(req: NextRequest) {
  try {
    // Get the authenticated user from Clerk
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check for Nango secret key
    const nangoSecretKey = process.env.NANGO_SECRET_KEY;
    if (!nangoSecretKey) {
      console.error('NANGO_SECRET_KEY is not configured');
      return NextResponse.json(
        { error: 'Nango not configured' },
        { status: 500 }
      );
    }

    // Initialize Nango with secret key
    const nango = new Nango({
      secretKey: nangoSecretKey,
    });

    // Check if this is a direct connection creation request
    const body = await req.json().catch(() => ({}));
    
    if (body.provider) {
      // MODE 2: Verify Nango connection exists and create DB row
      const providerMap: Record<string, string> = {
        gmail: 'google-mail',
        calendar: 'google-calendar',
        drive: 'google-drive',
      };
      const nangoProvider = providerMap[body.provider];
      
      if (!nangoProvider) {
        return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
      }
      
      // Try to find existing Nango connection for this user
      try {
        const connections = await nango.listConnections();
        const conn = connections.connections.find(
          (c) => c.provider_config_key === nangoProvider && 
                 (c.end_user?.id === userId || (c.metadata as Record<string, unknown>)?.clerk_user_id === userId)
        );
        
        if (conn) {
          // Found Nango connection - create/update DB row
          const supa = supabaseAdmin as unknown as SupabaseClient;
          const now = new Date().toISOString();
          
          await supa.from('connections').upsert({
            user_id: userId,
            provider: body.provider,
            connection_id: conn.connection_id,
            status: 'connected',
            metadata: { clerk_user_id: userId },
            updated_at: now,
            last_sync_at: now, // Set initial sync time
          }, { onConflict: 'user_id,provider' });
          
          console.log(`[nango/connect] Created/updated ${body.provider} connection for user ${userId}`);
          return NextResponse.json({ success: true, created: true });
        }
      } catch (listErr) {
        console.error('[nango/connect] Failed to list connections:', listErr);
      }
      
      return NextResponse.json({ success: false, error: 'No Nango connection found' }, { status: 404 });
    }

    // MODE 1: Create a connect session for OAuth flow
    const response = await nango.createConnectSession({
      end_user: {
        id: userId, // This is our Clerk user ID - Nango stores it with the connection
      },
      allowed_integrations: ['google-mail', 'google-calendar', 'google-drive'],
    });

    return NextResponse.json({
      sessionToken: response.data.token,
      expiresAt: response.data.expires_at,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in /api/nango/connect:', errorMessage);
    console.error('Full error:', JSON.stringify(error, null, 2));
    
    return NextResponse.json(
      { 
        error: 'Failed to process request',
        details: errorMessage
      },
      { status: 500 }
    );
  }
}
