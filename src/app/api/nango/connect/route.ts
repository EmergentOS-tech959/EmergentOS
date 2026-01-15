import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { Nango } from '@nangohq/node';

/**
 * POST /api/nango/connect
 * Creates a Nango connect session token for the authenticated user
 * This token is used by the frontend to initiate OAuth flows
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

    // Create a connect session for this user
    // Note: Integration name must match what's configured in Nango dashboard
    const response = await nango.createConnectSession({
      end_user: {
        id: userId, // This is our Clerk user ID - Nango stores it with the connection
      },
      allowed_integrations: ['google-mail'], // Must match Nango dashboard integration ID
    });

    return NextResponse.json({
      sessionToken: response.data.token,
      expiresAt: response.data.expires_at,
    });
  } catch (error: any) {
    console.error('Error creating Nango connect session:', error?.message || error);
    console.error('Full error:', JSON.stringify(error, null, 2));
    
    return NextResponse.json(
      { 
        error: 'Failed to create connect session',
        details: error?.message || 'Unknown error'
      },
      { status: 500 }
    );
  }
}
