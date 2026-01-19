'use client';

import { useState } from 'react';
import Nango from '@nangohq/frontend';
import { Button } from '@/components/ui/button';
import { Calendar, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ConnectCalendarProps {
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

export function ConnectCalendar({
  onConnectionStart,
  onConnectionSuccess,
  onConnectionError,
  label = 'Connect Calendar',
  showIcon = true,
  buttonVariant = 'default',
  buttonSize = 'default',
  className,
}: ConnectCalendarProps) {
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

      // Opens Google OAuth popup for Calendar scopes configured in Nango
      await nango.auth('google-calendar');

      onConnectionSuccess?.();
      toast.success('Calendar connected', {
        description: 'Sync runs securely in the background. It usually takes a few seconds to a minute.',
      });
      setState('idle');
    } catch (error) {
      console.error('Calendar connection error:', error);
      const message = error instanceof Error ? error.message : 'Failed to connect Calendar';
      onConnectionError?.(error instanceof Error ? error : new Error(message));
      toast.error('Calendar connection failed', { description: message });
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
          {showIcon ? <Calendar className="h-4 w-4" /> : null}
          {label}
        </>
      )}
    </Button>
  );
}

