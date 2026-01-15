'use client';

import { Shield, Loader2, Lock, Scan } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { SyncStatus } from '@/types';

interface SecurityStatusProps {
  status: Extract<SyncStatus, 'fetching' | 'securing'>;
}

/**
 * SecurityStatus Component
 * Displays the current state of the email sync pipeline
 * 
 * States:
 * - fetching: Retrieving emails from Gmail via Nango
 * - securing: Running mock DLP scan (2-second delay)
 */
export function SecurityStatus({ status }: SecurityStatusProps) {
  const isFetching = status === 'fetching';
  const isSecuring = status === 'securing';

  return (
    <Card className="p-8 bg-card border-border overflow-hidden relative">
      {/* Animated background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 animate-pulse" />
      
      <div className="relative flex flex-col items-center justify-center space-y-6">
        {/* Icon with spinner */}
        <div className="relative">
          <div className={`
            h-20 w-20 rounded-full flex items-center justify-center
            ${isSecuring ? 'bg-primary/20' : 'bg-secondary'}
            transition-colors duration-500
          `}>
            {isFetching ? (
              <Lock className="h-10 w-10 text-primary" />
            ) : (
              <Shield className="h-10 w-10 text-primary" />
            )}
          </div>
          
          {/* Spinning loader */}
          <div className="absolute -inset-2">
            <Loader2 className="h-24 w-24 text-primary/30 animate-spin" />
          </div>
        </div>

        {/* Status text */}
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-semibold text-foreground">
            {isFetching ? 'Fetching Emails...' : 'Securing Data...'}
          </h2>
          <p className="text-muted-foreground max-w-md">
            {isFetching 
              ? 'Retrieving your latest messages from Gmail via Nango'
              : 'Running DLP security verification before display'
            }
          </p>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center gap-4">
          <StepIndicator 
            icon={<Lock className="h-4 w-4" />}
            label="Fetch"
            isActive={isFetching}
            isComplete={isSecuring}
          />
          <div className={`h-px w-8 ${isSecuring ? 'bg-primary' : 'bg-border'} transition-colors`} />
          <StepIndicator 
            icon={<Scan className="h-4 w-4" />}
            label="DLP Scan"
            isActive={isSecuring}
            isComplete={false}
          />
          <div className="h-px w-8 bg-border" />
          <StepIndicator 
            icon={<Shield className="h-4 w-4" />}
            label="Secure"
            isActive={false}
            isComplete={false}
          />
        </div>

        {/* DLP indicator */}
        {isSecuring && (
          <div className="flex items-center gap-2 text-sm text-primary animate-pulse">
            <div className="h-2 w-2 rounded-full bg-primary animate-ping" />
            <span className="font-medium">Nightfall DLP Scan in Progress</span>
          </div>
        )}

        {/* Technical info */}
        <p className="text-xs text-muted-foreground font-mono">
          {isFetching 
            ? 'nango.proxy → gmail/v1/users/me/messages'
            : 'step.sleep("mock-dlp-scan", "2s")'
          }
        </p>
      </div>
    </Card>
  );
}

function StepIndicator({ 
  icon, 
  label, 
  isActive, 
  isComplete 
}: { 
  icon: React.ReactNode; 
  label: string; 
  isActive: boolean;
  isComplete: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`
        h-8 w-8 rounded-full flex items-center justify-center transition-all duration-300
        ${isComplete 
          ? 'bg-primary text-primary-foreground' 
          : isActive 
            ? 'bg-primary/20 text-primary ring-2 ring-primary ring-offset-2 ring-offset-background' 
            : 'bg-secondary text-muted-foreground'
        }
      `}>
        {icon}
      </div>
      <span className={`text-xs ${isActive || isComplete ? 'text-foreground' : 'text-muted-foreground'}`}>
        {label}
      </span>
    </div>
  );
}

