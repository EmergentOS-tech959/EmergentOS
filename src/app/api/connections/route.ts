/**
 * EmergentOS - Connections API
 * 
 * Returns all OAuth connections for the authenticated user.
 * Per Section 8.2: GET /api/connections
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';

// Response shape per Section 17: ConnectionStatus
interface ConnectionStatus {
  status: 'connected' | 'disconnected' | 'error';
  lastSyncAt: string | null;
  error: string | null;
}

type ProviderKey = 'gmail' | 'calendar' | 'drive';

export async function GET() {
  try {
    // Authenticate with Clerk
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Fetch all connections for this user
    const { data: connections, error } = await supabase
      .from('connections')
      .select('provider, status, last_sync_at, metadata')
      .eq('user_id', userId);
    
    if (error) {
      console.error('[Connections API] Database error:', error);
      return NextResponse.json(
        { error: 'Database error' },
        { status: 500 }
      );
    }
    
    // Initialize all providers as disconnected
    const result: Record<ProviderKey, ConnectionStatus> = {
      gmail: { status: 'disconnected', lastSyncAt: null, error: null },
      calendar: { status: 'disconnected', lastSyncAt: null, error: null },
      drive: { status: 'disconnected', lastSyncAt: null, error: null }
    };
    
    // Override with actual connection data
    for (const conn of connections || []) {
      const provider = conn.provider as ProviderKey;
      if (provider in result) {
        result[provider] = {
          status: conn.status as ConnectionStatus['status'],
          lastSyncAt: conn.last_sync_at || null,
          error: (conn.metadata as Record<string, unknown>)?.error_reason as string || null
        };
      }
    }
    
    return NextResponse.json({ connections: result });
    
  } catch (error) {
    console.error('[Connections API] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
