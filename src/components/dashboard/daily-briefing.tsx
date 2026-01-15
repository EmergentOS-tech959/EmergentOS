'use client';

import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, Sparkles, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Briefing {
  id: string;
  summary: string;
  key_priorities: Array<{ title: string; description: string; source?: string }>;
  schedule_summary: { conflicts: unknown[]; key_meetings: unknown[] };
  generated_at: string;
}

export function DailyBriefingWidget() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showPriorities, setShowPriorities] = useState(true);
  const [showSchedule, setShowSchedule] = useState(true);

  const fetchBriefing = useCallback(async () => {
    try {
      if (!user?.id) return;
      setIsLoading(true);
      const today = new Date().toISOString().split('T')[0];

      const res = await fetch(`/api/ai/briefing/${today}`, { method: 'GET' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to fetch briefing');
      setBriefing((body?.briefing as Briefing | null) || null);
    } catch (error) {
      console.error('Error fetching briefing:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!isLoaded) return;
    void fetchBriefing();
  }, [isLoaded, fetchBriefing]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    toast.info('Generating new briefing...', {
      description: 'Analyzing your emails, calendar, and documents.',
    });

    try {
      // Trigger briefing generation via API
      const response = await fetch('/api/ai/briefing/generate', { method: 'POST' });
      
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to generate briefing');
      }
      
      if (data?.success === true) {
        // Poll until the row is written by the Inngest worker (up to 30s)
        const startedAt = Date.now();
        let attempts = 0;
        const poll = async () => {
          attempts += 1;
          await fetchBriefing();
          const elapsed = Date.now() - startedAt;
          if (elapsed >= 30_000) return;
          // If we already have a briefing, stop polling
          const today = new Date().toISOString().split('T')[0];
          const res = await fetch(`/api/ai/briefing/${today}`, { method: 'GET' });
          const body = await res.json().catch(() => ({}));
          if (res.ok && body?.briefing?.id) return;
          await new Promise((r) => setTimeout(r, Math.min(1500 + attempts * 250, 3000)));
          return poll();
        };
        await poll();
        toast.success('Briefing updated');
        return;
      }

      // If server queued/fell back, show message and do NOT claim success.
      const msg = data?.error || data?.warning || 'Briefing generation was queued';
      toast.warning(msg);
    } catch (error) {
      console.error('Generation error:', error);
      toast.error('Failed to generate briefing', {
        description: error instanceof Error ? error.message : 'Please try again later.',
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!isLoaded || isLoading) {
    return (
      <Card className="col-span-1 md:col-span-2 p-6 border-border h-full min-h-[300px]">
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
        <div className="mt-8 space-y-4">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </Card>
    );
  }

  if (!briefing) {
    return (
      <Card className="col-span-1 md:col-span-2 p-8 border-border h-full flex flex-col items-center justify-center text-center min-h-[300px]">
        <div className="h-16 w-16 rounded-full bg-ai-copper/10 flex items-center justify-center mb-4">
          <Sparkles className="h-8 w-8 text-ai-copper" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Daily Strategic Briefing</h3>
        <p className="text-muted-foreground max-w-md mb-6">
          Sync your accounts to generate a daily briefing from emails, calendar events, and documents.
        </p>
        <Button 
          onClick={() => router.push('/settings')}
          disabled={isRefreshing}
          className="bg-ai-copper hover:bg-ai-copper/90 text-white"
        >
          {isRefreshing ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Connect Accounts
            </>
          )}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="col-span-1 md:col-span-2 p-6 border-border h-full flex flex-col">
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-ai-copper/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-ai-copper" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Daily Briefing</h3>
            <p className="text-xs text-muted-foreground">
              Generated {new Date(briefing.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className={cn(isRefreshing && "animate-spin")}
        >
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>

      <div className="flex-1 space-y-6">
        {/* Executive Summary */}
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <p className="text-muted-foreground leading-relaxed">
            {briefing.summary}
          </p>
        </div>

        {/* Key Priorities (Collapsible) */}
        <div className="space-y-3">
          <button
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            onClick={() => setShowPriorities(prev => !prev)}
          >
            {showPriorities ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Top Priorities
          </button>
          {showPriorities && (
            <div className="grid gap-3">
              {briefing.key_priorities?.map((priority, index) => (
                <div 
                  key={index}
                  className="group flex gap-4 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors border border-transparent hover:border-border"
                >
                  <div className="mt-0.5">
                    <div className="h-5 w-5 rounded-full border-2 border-ai-copper/50 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-ai-copper">{index + 1}</span>
                    </div>
                  </div>
                  <div>
                    <h5 className="font-medium text-sm text-foreground mb-1">
                      {priority.title}
                    </h5>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {priority.description}
                    </p>
                  </div>
                  <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Schedule Summary (Collapsible) */}
        <div className="space-y-3">
          <button
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            onClick={() => setShowSchedule(prev => !prev)}
          >
            {showSchedule ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Schedule Overview
          </button>
          {showSchedule && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
              <span>Conflicts: {briefing.schedule_summary?.conflicts?.length || 0}</span>
              <span>Key Meetings: {briefing.schedule_summary?.key_meetings?.length || 0}</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
