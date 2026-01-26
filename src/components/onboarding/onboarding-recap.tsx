'use client';

/**
 * EmergentOS - Onboarding Recap
 * 
 * Displays the AI-generated Smart Recap for user confirmation.
 */

import { useState } from 'react';
import { CheckCircle2, RotateCcw, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface OnboardingRecapProps {
  recap: string;
  onConfirm: () => void;
  onRestart: () => void;
  className?: string;
}

export function OnboardingRecap({
  recap,
  onConfirm,
  onRestart,
  className,
}: OnboardingRecapProps) {
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirm = async () => {
    setIsConfirming(true);
    await onConfirm();
    setIsConfirming(false);
  };

  return (
    <div className={cn(
      'flex flex-col items-center justify-center',
      'px-4 py-8 max-w-2xl mx-auto',
      className
    )}>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500/20 to-teal-600/20 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-teal-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Smart Recap
          </h2>
          <p className="text-xs text-muted-foreground">
            Here is what I have learned about you
          </p>
        </div>
      </div>

      <div className={cn(
        'w-full rounded-2xl',
        'bg-secondary/30 border border-border/50',
        'relative flex flex-col max-h-[60vh]'
      )}>
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-teal-500/50 via-sky-500/50 to-teal-500/50 z-10" />
        <div className="p-6 overflow-y-auto eos-scrollbar-thin">
        <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
          {recap}
            </div>
          </div>
      </div>

      <div className="flex items-center gap-3 mt-6">
        <Button
          variant="outline"
          size="sm"
          onClick={onRestart}
          disabled={isConfirming}
          className="gap-2 text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-4 w-4" />
          Start Over
        </Button>
        <Button
          size="sm"
          onClick={handleConfirm}
          disabled={isConfirming}
          className="gap-2 bg-teal-500 hover:bg-teal-600 text-white"
        >
          {isConfirming ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Confirming...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Yes, that is right
            </>
          )}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground mt-4 text-center max-w-md">
        If something does not quite fit, click Start Over to begin again. Otherwise, confirm to continue.
      </p>
    </div>
  );
}
