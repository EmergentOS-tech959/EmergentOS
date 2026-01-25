/**
 * EmergentOS - Nango Connect Session API
 * 
 * Creates a connect session token for frontend OAuth.
 * This allows OAuth without exposing a public key.
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { nango, PROVIDER_CONFIG_KEYS, type ProviderKey } from '@/lib/nango';

export async function POST(request: Request) {
  try {
    // Authenticate with Clerk
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Parse request body
    const body = await request.json().catch(() => ({}));
    const provider = body.provider as ProviderKey;
    
    if (!provider || !PROVIDER_CONFIG_KEYS[provider]) {
      return NextResponse.json(
        { error: 'Invalid provider' },
        { status: 400 }
      );
    }
    
    const providerConfigKey = PROVIDER_CONFIG_KEYS[provider];
    
    // Create connect session using Nango server SDK
    // This generates a session token that can be used by the frontend
    const connectSession = await nango.createConnectSession({
      end_user: {
        id: userId,
        email: undefined,  // Optional
        display_name: undefined  // Optional
      },
      organization: undefined,
      allowed_integrations: [providerConfigKey],
      integrations_config_defaults: {}
    });
    
    console.log('[Nango Connect Session] Created for user:', userId, 'provider:', provider);
    
    return NextResponse.json({
      sessionToken: connectSession.data.token,
      provider,
      providerConfigKey
    });
    
  } catch (error) {
    console.error('[Nango Connect Session] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create connect session' },
      { status: 500 }
    );
  }
}
