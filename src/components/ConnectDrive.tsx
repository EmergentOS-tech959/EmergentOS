'use client';

import { useState } from 'react';
import Nango from '@nangohq/frontend';
import { Button } from '@/components/ui/button';
import { Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ConnectDriveProps {
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

export function ConnectDrive({
  onConnectionStart,
  onConnectionSuccess,
  onConnectionError,
  label = 'Connect Drive',
  showIcon = true,
  buttonVariant = 'default',
  buttonSize = 'default',
  className,
}: ConnectDriveProps) {
  const [state, setState] = useState<ConnectionState>('idle');

  const handleConnect = async () => {
    onConnectionStart?.();
    setState('connecting');

    try {
      const response = await fetch('/api/nango/connect', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to create connect session');
      }

      const { sessionToken } = await response.json();
      const nango = new Nango({ connectSessionToken: sessionToken });

      // Opens Google OAuth popup for Drive scopes configured in Nango
      await nango.auth('google-drive');

      onConnectionSuccess?.();
      toast.success('Drive connected', {
        description: 'Sync runs securely in the background. It usually takes a few seconds to a minute.',
      });
      setState('idle');
    } catch (error) {
      console.error('Drive connection error:', error);
      const message = error instanceof Error ? error.message : 'Failed to connect Drive';
      onConnectionError?.(error instanceof Error ? error : new Error(message));
      toast.error('Drive connection failed', { description: message });
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
          {showIcon ? <Upload className="h-4 w-4" /> : null}
          {label}
        </>
      )}
    </Button>
  );
}

