import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { inngest } from '@/lib/inngest';

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

    // Trigger the Inngest function directly
    await inngest.send({
      name: 'gmail/connection.established',
      data: {
        userId: userId,
        providerConfigKey: 'google-mail',
        timestamp: new Date().toISOString(),
        manual: true, // Flag to indicate this was manually triggered
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Sync triggered successfully',
      userId: userId,
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

