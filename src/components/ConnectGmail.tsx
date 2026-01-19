'use client';

import { useState } from 'react';
import Nango from '@nangohq/frontend';
import { Button } from '@/components/ui/button';
import { Mail, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ConnectGmailProps {
  onConnectionStart?: () => void;
  onConnectionSuccess?: () => void;
  onConnectionError?: (error: Error) => void;
  label?: string;
  showIcon?: boolean;
  buttonVariant?: React.ComponentProps<typeof Button>['variant'];
  buttonSize?: React.ComponentProps<typeof Button>['size'];
  className?: string;
}

type ConnectionState = 'idle' | 'connecting';

/**
 * ConnectGmail Component
 * Uses Nango's Connect Session Token approach for secure OAuth
 * 
 * Flow:
 * 1. User clicks "Connect Gmail"
 * 2. Frontend calls /api/nango/connect to get a session token
 * 3. Nango opens Google OAuth consent screen
 * 4. On success, Nango sends webhook to /api/nango/webhook
 * 5. Webhook triggers Inngest function
 */
export function ConnectGmail({ 
  onConnectionStart,
  onConnectionSuccess, 
  onConnectionError,
  label = 'Connect Gmail',
  showIcon = true,
  buttonVariant = 'default',
  buttonSize = 'default',
  className,
}: ConnectGmailProps) {
  const [state, setState] = useState<ConnectionState>('idle');

  const handleConnect = async () => {
    onConnectionStart?.();
    setState('connecting');

    try {
      // Step 1: Get a connect session token from our backend
      const response = await fetch('/api/nango/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to create connect session');
      }

      const { sessionToken } = await response.json();

      // Step 2: Initialize Nango with the session token
      const nango = new Nango({
        connectSessionToken: sessionToken,
      });

      // Step 3: Trigger the OAuth flow
      // This opens a popup for Google OAuth consent
      await nango.auth('google-mail');

      // Step 4: OAuth completed successfully
      // The webhook will be triggered automatically by Nango
      onConnectionSuccess?.();
      toast.success('Gmail connected', {
        description: 'Sync runs securely in the background. It usually takes a few seconds to a minute.',
      });
      setState('idle');

    } catch (error) {
      console.error('Gmail connection error:', error);
      
      const message = error instanceof Error 
        ? error.message 
        : 'Failed to connect Gmail';
      onConnectionError?.(error instanceof Error ? error : new Error(message));
      toast.error('Gmail connection failed', { description: message });
      setState('idle');
    }
  };

  return (
    <Button
      onClick={handleConnect}
      disabled={state === 'connecting'}
      variant={buttonVariant}
      size={buttonSize}
      className={cn('gap-2', className)}
    >
      {state === 'connecting' ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Connecting…
        </>
      ) : (
        <>
          {showIcon ? <Mail className="h-4 w-4" /> : null}
          {label}
        </>
      )}
    </Button>
  );
}

