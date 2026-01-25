'use client';

import { useState, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import Nango from '@nangohq/frontend';
import { Button } from '@/components/ui/button';
import { Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ConnectDriveProps {
  onConnectionStart?: () => void;
  onSyncStart?: () => void;
  onConnectionSuccess?: () => void;
  onConnectionError?: (error: Error) => void;
  label?: string;
  showIcon?: boolean;
  buttonVariant?: React.ComponentProps<typeof Button>['variant'];
  buttonSize?: React.ComponentProps<typeof Button>['size'];
  className?: string;
}

type ConnectionState = 'idle' | 'connecting' | 'syncing';

const POLL_INTERVAL = 1000;  // 1 second
const POLL_TIMEOUT = 120000; // 2 minutes

/**
 * ConnectDrive Component
 * Initiates Drive OAuth via Nango connect session and polls for sync completion
 */
export function ConnectDrive({
  onConnectionStart,
  onSyncStart,
  onConnectionSuccess,
  onConnectionError,
  label = 'Connect Drive',
  showIcon = true,
  buttonVariant = 'default',
  buttonSize = 'default',
  className,
}: ConnectDriveProps) {
  const [state, setState] = useState<ConnectionState>('idle');
  const { user } = useUser();

  /**
   * Poll /api/connections until lastSyncAt is populated (sync complete)
   */
  const pollForSyncCompletion = useCallback(async (): Promise<boolean> => {
    const startTime = Date.now();
    
    while (Date.now() - startTime < POLL_TIMEOUT) {
      try {
        const response = await fetch('/api/connections');
        if (!response.ok) {
          throw new Error('Failed to fetch connections');
        }
        
        const { connections } = await response.json();
        const driveConnection = connections.drive;
        
        // Check if sync is complete (lastSyncAt is populated)
        if (driveConnection?.lastSyncAt) {
          return true;
        }
        
        // Check for error status
        if (driveConnection?.status === 'error') {
          throw new Error(driveConnection.error || 'Connection error');
        }
        
      } catch (error) {
        console.error('[ConnectDrive] Poll error:', error);
        // Continue polling on transient errors
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
    
    // Timeout - sync may still be in progress
    console.warn('[ConnectDrive] Polling timed out');
    return false;
  }, []);

  /**
   * Generate briefing after successful sync
   */
  const generateBriefing = useCallback(async () => {
    try {
      const response = await fetch('/api/ai/briefing/generate', {
        method: 'POST'
      });
      
      if (!response.ok) {
        console.warn('[ConnectDrive] Briefing generation failed');
      }
    } catch (error) {
      console.warn('[ConnectDrive] Briefing generation error:', error);
      // Don't fail the connection flow for briefing errors
    }
  }, []);

  /**
   * Handle Drive connection via Nango connect session
   */
  const handleConnect = async () => {
    if (!user?.id) {
      toast.error('Please sign in to connect Drive');
      return;
    }
    
    onConnectionStart?.();
    setState('connecting');

    try {
      // Step 1: Get connect session token from server
      const sessionResponse = await fetch('/api/nango/connect-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'drive' })
      });
      
      if (!sessionResponse.ok) {
        const errorData = await sessionResponse.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create connect session');
      }
      
      const { sessionToken } = await sessionResponse.json();
      
      // Step 2: Initialize Nango with session token and open OAuth popup
      const nango = new Nango({
        connectSessionToken: sessionToken
      });
      
      // Start OAuth flow - DO NOT pass connection_id when using session token
      // The user identity is already embedded in the session token via end_user.id
      await nango.auth('google-drive');
      
      // OAuth completed successfully, popup closed
      console.log('[ConnectDrive] OAuth completed, confirming connection...');
      
      // Call confirm-connection API as fallback (in case webhook doesn't fire)
      // This ensures the connection is created in Supabase
      const confirmResponse = await fetch('/api/nango/confirm-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'drive' })
      });
      
      if (!confirmResponse.ok) {
        const errorData = await confirmResponse.json().catch(() => ({}));
        console.error('[ConnectDrive] Confirm connection failed:', errorData);
        throw new Error(errorData.error || 'Failed to confirm connection');
      }
      
      const confirmData = await confirmResponse.json();
      console.log('[ConnectDrive] Connection confirmed:', confirmData);
      
      // Now poll for sync completion
      setState('syncing');
      onSyncStart?.(); // Notify SyncManager that syncing has started
      toast.info('Syncing Drive...', {
        description: 'This may take a minute for the initial sync.'
      });
      
      // Poll until sync completes
      const syncCompleted = await pollForSyncCompletion();
      
      if (syncCompleted) {
        // Generate briefing after successful sync
        await generateBriefing();
        
        // Dispatch custom event for UI updates
        window.dispatchEvent(
          new CustomEvent('eos:connections-updated', {
            detail: {
              providers: ['drive'],
              trigger: 'connect',
              dataChanged: true,
              briefingRegenerated: true,
              phase: 'complete'
            }
          })
        );
        
        toast.success('Drive connected successfully!');
        onConnectionSuccess?.();
      } else {
        // Timeout but sync may still complete in background
        toast.info('Drive sync in progress', {
          description: 'The sync is taking longer than expected. It will complete in the background.'
        });
        onConnectionSuccess?.(); // Still consider it a success
      }
      
    } catch (error) {
      console.error('[ConnectDrive] Connection error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      
      // Handle specific Nango errors
      if (errorMessage.includes('user_cancelled') || errorMessage.includes('closed')) {
        toast.info('Connection cancelled');
      } else {
        toast.error('Failed to connect Drive', {
          description: errorMessage
        });
      }
      
      onConnectionError?.(error instanceof Error ? error : new Error(errorMessage));
    } finally {
      setState('idle');
    }
  };

  return (
    <Button
      onClick={handleConnect}
      disabled={state !== 'idle'}
      variant={buttonVariant}
      size={buttonSize}
      className={cn('gap-2', className)}
    >
      {state === 'connecting' ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Connecting…
        </>
      ) : state === 'syncing' ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Syncing…
        </>
      ) : (
        <>
          {showIcon ? <Upload className="h-4 w-4" /> : null}
          {label}
        </>
      )}
    </Button>
  );
}
