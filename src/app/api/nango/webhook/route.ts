import { NextRequest, NextResponse } from 'next/server';
import { Nango } from '@nangohq/node';
import { inngest } from '@/lib/inngest';

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
      
      // First, try to get end_user.id from the webhook payload
      let clerkUserId = 
        payload.endUser?.id || 
        payload.end_user?.id || 
        payload.data?.endUser?.id ||
        payload.data?.end_user?.id ||
        payload.connection?.end_user_id;
      
      console.log('=== EXTRACTED FROM PAYLOAD ===');
      console.log('connectionId:', connectionId);
      console.log('clerkUserId from payload:', clerkUserId);
      
      // If not in payload, query Nango to get the connection details
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
          clerkUserId = (connection as any).end_user?.id || 
                        (connection as any).endUser?.id ||
                        (connection as any).metadata?.clerk_user_id;
          
          console.log('clerkUserId from Nango API:', clerkUserId);
        } catch (nangoError) {
          console.error('Failed to fetch connection from Nango:', nangoError);
        }
      }
      
      // Fallback to connectionId if we still don't have a Clerk user ID
      const finalUserId = clerkUserId || connectionId;
      
      console.log('=== FINAL IDs ===');
      console.log('finalUserId (for Supabase):', finalUserId);
      console.log('connectionId (for Nango):', connectionId);
      console.log('===================');
      
      // Only process google-mail connections
      if (providerConfigKey === 'google-mail' || provider === 'google-mail') {
        console.log(`Gmail connected - Clerk userId: ${finalUserId}, Nango connectionId: ${connectionId}`);
        
        // Trigger Inngest function to process emails
        await inngest.send({
          name: 'gmail/connection.established',
          data: {
            userId: finalUserId,         // For Supabase - Clerk user ID (or fallback to connectionId)
            connectionId: connectionId,  // For Nango proxy calls
            providerConfigKey: providerConfigKey || 'google-mail',
            timestamp: new Date().toISOString(),
          },
        });

        console.log('Inngest event sent: gmail/connection.established');
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
export async function GET(req: NextRequest) {
  return NextResponse.json({ 
    status: 'Nango webhook endpoint active',
    timestamp: new Date().toISOString(),
  });
}
