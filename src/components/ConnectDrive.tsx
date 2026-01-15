'use client';

import { useState } from 'react';
import Nango from '@nangohq/frontend';
import { Button } from '@/components/ui/button';
import { Upload, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface ConnectDriveProps {
  onConnectionSuccess?: () => void;
  onConnectionError?: (error: Error) => void;
}

type ConnectionState = 'idle' | 'connecting' | 'success' | 'error';

export function ConnectDrive({ onConnectionSuccess, onConnectionError }: ConnectDriveProps) {
  const [state, setState] = useState<ConnectionState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleConnect = async () => {
    setState('connecting');
    setErrorMessage('');

    try {
      const response = await fetch('/api/nango/connect', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to create connect session');
      }

      const { sessionToken } = await response.json();
      const nango = new Nango({ connectSessionToken: sessionToken });

      // Opens Google OAuth popup for Drive scopes configured in Nango
      await nango.auth('google-drive');

      setState('success');
      onConnectionSuccess?.();
    } catch (error) {
      console.error('Drive connection error:', error);
      setState('error');
      const message = error instanceof Error ? error.message : 'Failed to connect Drive';
      setErrorMessage(message);
      onConnectionError?.(error instanceof Error ? error : new Error(message));
    }
  };

  if (state === 'success') {
    return (
      <div className="flex items-center gap-2 text-status-green">
        <CheckCircle className="h-5 w-5" />
        <span className="font-medium">Drive Connected!</span>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-2 text-status-red">
          <AlertCircle className="h-5 w-5" />
          <span className="font-medium">Connection Failed</span>
        </div>
        <p className="text-sm text-muted-foreground">{errorMessage}</p>
        <Button onClick={handleConnect} variant="outline" className="gap-2">
          <Upload className="h-4 w-4" />
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
          <Upload className="h-4 w-4" />
          Connect Drive
        </>
      )}
    </Button>
  );
}

