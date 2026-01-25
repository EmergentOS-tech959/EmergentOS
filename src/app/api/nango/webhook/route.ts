/**
 * EmergentOS - Nango Webhook Handler
 * 
 * Receives webhook events from Nango when OAuth connections are established.
 * Per Section 5: Connection Flow: Initial Connect
 */

import { NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { supabase } from '@/lib/supabase';
import { inngest } from '@/lib/inngest';
import { PROVIDER_FROM_CONFIG_KEY, type ConfigKey } from '@/lib/nango';

// Nango webhook payload structure
interface NangoWebhookPayload {
  type: 'auth' | 'sync' | 'forward';
  connectionId: string;
  providerConfigKey: string;
  provider?: string;
  environment?: string;
  success?: boolean;
  operation?: string;
  endUser?: {
    id: string;
    email?: string;
  };
  error?: {
    type: string;
    message: string;
  };
}

/**
 * Validate Nango webhook signature (if secret is configured)
 */
function validateSignature(body: string, signature: string | null, secret: string | null): boolean {
  if (!secret || !signature) {
    // If no secret configured, skip validation (for development)
    return true;
  }
  
  const expectedSig = createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  
  return signature === expectedSig;
}

export async function POST(request: Request) {
  let bodyText: string;
  let payload: NangoWebhookPayload;
  
  try {
    // Read body as text for signature validation
    bodyText = await request.text();
    payload = JSON.parse(bodyText);
  } catch {
    console.error('[Nango Webhook] Failed to parse request body');
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  
  // Validate webhook signature (if configured)
  const signature = request.headers.get('x-nango-signature');
  const secret = process.env.NANGO_WEBHOOK_SECRET || null;
  
  if (!validateSignature(bodyText, signature, secret)) {
    console.error('[Nango Webhook] Invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  
  console.log('[Nango Webhook] Received:', {
    type: payload.type,
    providerConfigKey: payload.providerConfigKey,
    connectionId: payload.connectionId,
    endUserId: payload.endUser?.id,
    success: payload.success
  });
  
  // Only process successful auth events
  if (payload.type !== 'auth' || !payload.success) {
    console.log('[Nango Webhook] Ignoring non-auth or failed event');
    return NextResponse.json({ received: true });
  }
  
  // Extract and validate required fields
  const { connectionId, providerConfigKey, endUser } = payload;
  
  if (!connectionId || !providerConfigKey || !endUser?.id) {
    console.error('[Nango Webhook] Missing required fields:', {
      connectionId,
      providerConfigKey,
      endUserId: endUser?.id
    });
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  
  // Map Nango config key to our provider name
  const provider = PROVIDER_FROM_CONFIG_KEY[providerConfigKey as ConfigKey];
  
  if (!provider) {
    console.error('[Nango Webhook] Unknown provider config key:', providerConfigKey);
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  }
  
  const userId = endUser.id;
  
  try {
    // STEP 3A: UPSERT connection with last_sync_at = NULL (CRITICAL!)
    // Per Section 5.2: This must be NULL, not current time
    const { data: connection, error: connectionError } = await supabase
      .from('connections')
      .upsert({
        user_id: userId,
        provider: provider,
        connection_id: connectionId,
        status: 'connected',
        last_sync_at: null,  // CRITICAL: NULL for initial sync
        metadata: { 
          clerk_user_id: userId,
          nango_provider_config_key: providerConfigKey
        },
        updated_at: new Date().toISOString()
      }, { 
        onConflict: 'user_id,provider' 
      })
      .select()
      .single();
    
    if (connectionError) {
      console.error('[Nango Webhook] Failed to upsert connection:', connectionError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }
    
    console.log('[Nango Webhook] Connection upserted:', {
      connectionId: connection.id,
      provider,
      userId
    });
    
    // STEP 3A: Create sync_job BEFORE sending Inngest event
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
      console.error('[Nango Webhook] Failed to create sync job:', jobError);
      // Continue anyway - Inngest can still process
    } else {
      console.log('[Nango Webhook] Sync job created:', jobId);
    }
    
    // STEP 3A: Send Inngest event with jobId
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
    
    console.log('[Nango Webhook] Inngest event sent:', `${provider}/sync.requested`);
    
    return NextResponse.json({ received: true });
    
  } catch (error) {
    console.error('[Nango Webhook] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Handle OPTIONS for CORS (if needed)
export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}
