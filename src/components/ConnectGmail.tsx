'use client';

import { useState } from 'react';
import Nango from '@nangohq/frontend';
import { Button } from '@/components/ui/button';
import { Mail, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface ConnectGmailProps {
  onConnectionSuccess?: () => void;
  onConnectionError?: (error: Error) => void;
}

type ConnectionState = 'idle' | 'connecting' | 'success' | 'error';

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
  onConnectionSuccess, 
  onConnectionError 
}: ConnectGmailProps) {
  const [state, setState] = useState<ConnectionState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleConnect = async () => {
    setState('connecting');
    setErrorMessage('');

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
      setState('success');
      onConnectionSuccess?.();

    } catch (error) {
      console.error('Gmail connection error:', error);
      setState('error');
      
      const message = error instanceof Error 
        ? error.message 
        : 'Failed to connect Gmail';
      setErrorMessage(message);
      onConnectionError?.(error instanceof Error ? error : new Error(message));
    }
  };

  // Render based on state
  if (state === 'success') {
    return (
      <div className="flex items-center gap-2 text-green-500">
        <CheckCircle className="h-5 w-5" />
        <span className="font-medium">Gmail Connected!</span>
        <span className="text-muted-foreground text-sm">Processing emails...</span>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-2 text-red-500">
          <AlertCircle className="h-5 w-5" />
          <span className="font-medium">Connection Failed</span>
        </div>
        <p className="text-sm text-muted-foreground">{errorMessage}</p>
        <Button
          onClick={handleConnect}
          variant="outline"
          className="gap-2"
        >
          <Mail className="h-4 w-4" />
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <Button
      onClick={handleConnect}
      disabled={state === 'connecting'}
      className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
    >
      {state === 'connecting' ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Connecting...
        </>
      ) : (
        <>
          <Mail className="h-4 w-4" />
          Connect Gmail
        </>
      )}
    </Button>
  );
}

