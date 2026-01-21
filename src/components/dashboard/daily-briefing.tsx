'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { 
  Sparkles, 
  ChevronRight, 
  Mail, 
  Calendar, 
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Zap,
  Target
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSyncManager, type ProviderKey } from '@/lib/sync-manager';

interface Briefing {
  id: string;
  summary: string;
  content?: string;
  key_priorities: Array<{ title: string; description: string; source?: string }>;
  schedule_summary: { conflicts: unknown[]; key_meetings: unknown[] };
  generated_at: string;
}

const PROVIDERS = {
  gmail: { icon: Mail, label: 'Gmail', color: 'text-rose-400', bg: 'bg-rose-500/15', border: 'border-rose-500/20' },
  calendar: { icon: Calendar, label: 'Calendar', color: 'text-sky-400', bg: 'bg-sky-500/15', border: 'border-sky-500/20' },
  drive: { icon: FileText, label: 'Drive', color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/20' },
};

export function DailyBriefingWidget() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Use centralized sync manager for provider status
  // NOTE: Refresh button removed - use unified refresh in dashboard header
  const { providers, isSyncing } = useSyncManager();
  
  // REAL-TIME TIMESTAMP: Tick state forces re-render every minute for live updates
  const [timeTick, setTimeTick] = useState(0);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  useEffect(() => {
    // Update every 60 seconds to keep "Xm ago" accurate
    tickIntervalRef.current = setInterval(() => {
      setTimeTick((t) => t + 1);
    }, 60000);
    return () => {
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    };
  }, []);
  
  // Compute display time from briefing's generated_at (updates every minute via timeTick)
  const briefingDisplayTime = useMemo(() => {
    // timeTick dependency ensures this re-computes every minute
    void timeTick;
    if (!briefing?.generated_at) return 'Never synced';
    const generated = new Date(briefing.generated_at);
    const now = new Date();
    const diffMs = now.getTime() - generated.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return generated.toLocaleDateString();
  }, [briefing?.generated_at, timeTick]);

  const connectedProviders = useMemo(
    () => (['gmail', 'calendar', 'drive'] as ProviderKey[]).filter((p) => providers[p].status === 'connected'),
    [providers]
  );
  const disconnectedProviders = useMemo(
    () => (['gmail', 'calendar', 'drive'] as ProviderKey[]).filter((p) => providers[p].status !== 'connected'),
    [providers]
  );

  const fetchBriefing = useCallback(async () => {
    try {
      if (!user?.id) return;
      setIsLoading(true);
      const today = new Date().toISOString().split('T')[0];
      // CRITICAL: Use cache: 'no-store' to always get fresh data
      const res = await fetch(`/api/ai/briefing/${today}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setBriefing(body?.briefing || null);
    } catch { /* error */ } finally { setIsLoading(false); }
  }, [user?.id]);

  // Initial load
  useEffect(() => {
    if (!isLoaded) return;
    void fetchBriefing();
  }, [isLoaded, fetchBriefing]);

  // Listen for sync completions to refetch briefing
  useEffect(() => {
    const handler = async (e: Event) => {
      const ce = e as CustomEvent<{ source?: string; phase?: string }>;
      // Refetch briefing after any sync completion (briefing regenerated in SyncManager)
      if (ce?.detail?.phase === 'complete') {
        // Poll for new briefing (wait for regeneration to complete)
        const oldGeneratedAt = briefing?.generated_at;
        const maxAttempts = 10;
        const pollInterval = 2000; // 2 seconds
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, pollInterval));
          
          // Check if we got a newer briefing
          const today = new Date().toISOString().split('T')[0];
          const res = await fetch(`/api/ai/briefing/${today}`, { cache: 'no-store' });
          const body = await res.json().catch(() => ({}));
          const newGeneratedAt = body?.briefing?.generated_at;
          
          if (newGeneratedAt && (!oldGeneratedAt || newGeneratedAt > oldGeneratedAt)) {
            // Got a newer briefing
            setBriefing(body?.briefing || null);
            return;
          }
        }
        
        // Fallback: just fetch whatever is there
        await fetchBriefing();
      }
    };
    window.addEventListener('eos:connections-updated', handler as EventListener);
    return () => window.removeEventListener('eos:connections-updated', handler as EventListener);
  }, [fetchBriefing, briefing?.generated_at]);

  // Listen for provider disconnections to refetch briefing (regenerated without that source)
  useEffect(() => {
    const handler = async () => {
      // Poll for new briefing (wait for regeneration to complete)
      const oldGeneratedAt = briefing?.generated_at;
      const maxAttempts = 10;
      const pollInterval = 2000; // 2 seconds
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, pollInterval));
        await fetchBriefing();
        
        // Check if we got a newer briefing
        // Note: briefing state won't update here due to closure, so we need to refetch
        const today = new Date().toISOString().split('T')[0];
        const res = await fetch(`/api/ai/briefing/${today}`, { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        const newGeneratedAt = body?.briefing?.generated_at;
        
        if (newGeneratedAt && (!oldGeneratedAt || newGeneratedAt > oldGeneratedAt)) {
          // Got a newer briefing
          setBriefing(body?.briefing || null);
          return;
        }
      }
      
      // Fallback: just fetch whatever is there
      await fetchBriefing();
    };
    window.addEventListener('eos:provider-disconnected', handler);
    return () => window.removeEventListener('eos:provider-disconnected', handler);
  }, [fetchBriefing, briefing?.generated_at]);

  // NOTE: handleRefresh removed - use unified refresh button in dashboard header

  if (!isLoaded || isLoading) {
    return (
      <Card className="p-5 h-full flex flex-col">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
        <div className="space-y-3 flex-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      </Card>
    );
  }

  // All disconnected
  if (connectedProviders.length === 0) {
    return (
      <Card className="p-6 h-full flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div className="widget-header">
            <div className="widget-icon bg-gradient-to-br from-amber-500/20 to-orange-500/10 ring-1 ring-amber-500/20">
              <Sparkles className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h3 className="widget-title">Daily Briefing</h3>
              <p className="widget-subtitle">No sources connected</p>
            </div>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <div className="relative mb-5">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 to-orange-500/10 rounded-2xl blur-xl" />
            <div className="relative h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center ring-1 ring-amber-500/20">
              <Sparkles className="h-8 w-8 text-amber-400" />
            </div>
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Daily Strategic Briefing</h3>
          <p className="text-sm text-muted-foreground max-w-xs mb-6 leading-relaxed">
            Connect your data sources to generate AI-powered briefings from emails, calendar, and documents.
          </p>
          <div className="flex items-center gap-2 mb-6">
            {(['gmail', 'calendar', 'drive'] as ProviderKey[]).map((p) => {
              const { icon: Icon, label, color, bg, border } = PROVIDERS[p];
              return (
                <div key={p} className={cn('flex items-center gap-1.5 px-3 py-2 rounded-lg border', bg, border)}>
                  <Icon className={cn('h-3.5 w-3.5', color)} />
                  <span className="text-xs text-muted-foreground font-medium">{label}</span>
                </div>
              );
            })}
          </div>
          <Button onClick={() => router.push('/settings')} className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-6">
            Connect Accounts
          </Button>
        </div>
      </Card>
    );
  }

  // No briefing yet
  if (!briefing) {
    return (
      <Card className="p-6 h-full flex flex-col">
        <div className="flex items-start justify-between mb-5">
          <div className="widget-header">
            <div className="widget-icon bg-gradient-to-br from-amber-500/20 to-orange-500/10 ring-1 ring-amber-500/20">
              <Sparkles className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h3 className="widget-title">Daily Briefing</h3>
              <p className="widget-subtitle">{connectedProviders.length} source{connectedProviders.length !== 1 ? 's' : ''} connected</p>
            </div>
          </div>
        </div>
        <SourcePills providers={providers} />
        <div className="flex-1 flex flex-col items-center justify-center py-8">
          <p className="text-sm text-muted-foreground mb-5">
            {isSyncing ? 'Syncing data...' : 'No briefing generated for today yet.'}
          </p>
          <p className="text-xs text-muted-foreground">Use the Refresh button in the header to generate a briefing</p>
        </div>
      </Card>
    );
  }

  // Has briefing
  return (
    <>
      <Card className="p-6 h-full flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="widget-header">
            <div className="widget-icon bg-gradient-to-br from-amber-500/20 to-orange-500/10 ring-1 ring-amber-500/20">
              <Sparkles className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h3 className="widget-title">Daily Briefing</h3>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {briefingDisplayTime}
              </div>
            </div>
          </div>
        </div>

        {/* Source pills */}
        <SourcePills providers={providers} disconnectedCount={disconnectedProviders.length} />

        {/* Summary */}
        <p className="text-sm text-foreground/80 leading-relaxed line-clamp-3 mb-5">
          {briefing.summary}
        </p>

        {/* Key Priorities */}
        {briefing.key_priorities && briefing.key_priorities.length > 0 && (
          <div className="flex-1 space-y-2.5 overflow-y-auto mb-4 eos-scrollbar-thin">
            {briefing.key_priorities.slice(0, 3).map((priority, i) => (
              <div key={i} className="flex gap-3 p-3.5 rounded-xl bg-secondary/50 hover:bg-secondary/80 transition-colors border border-transparent hover:border-border">
                <div className={cn('priority-badge shrink-0 mt-0.5', i === 0 ? 'priority-badge-1' : i === 1 ? 'priority-badge-2' : 'priority-badge-3')}>
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm text-foreground truncate">{priority.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{priority.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="pt-4 border-t border-border flex items-center justify-end">
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground font-medium" onClick={() => setShowModal(true)}>
            View Full Briefing <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </Card>

      <BriefingModal 
        isOpen={showModal} 
        onClose={() => setShowModal(false)} 
        briefing={briefing} 
        providers={providers} 
        globalSyncDisplay={briefingDisplayTime}
      />
    </>
  );
}

function SourcePills({ 
  providers, 
  disconnectedCount 
}: { 
  providers: Record<ProviderKey, { status: string; lastSyncAt: string | null; isSyncing: boolean }>; 
  disconnectedCount?: number;
}) {
  // Directly compute connected status for each provider
  const gmailConnected = providers.gmail?.status === 'connected';
  const calendarConnected = providers.calendar?.status === 'connected';
  const driveConnected = providers.drive?.status === 'connected';
  
  return (
    <div className="flex items-center gap-2 mb-4">
      {/* Gmail */}
      <div className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
        gmailConnected ? 'bg-rose-500/10 border border-rose-500/20' : 'bg-secondary/50 border border-border'
      )}>
        <Mail className={cn('h-3.5 w-3.5', gmailConnected ? 'text-rose-400' : 'text-muted-foreground/50')} />
        {gmailConnected ? <CheckCircle2 className="h-3 w-3 text-status-green" /> : <AlertTriangle className="h-3 w-3 text-status-amber" />}
      </div>
      
      {/* Calendar */}
      <div className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
        calendarConnected ? 'bg-sky-500/10 border border-sky-500/20' : 'bg-secondary/50 border border-border'
      )}>
        <Calendar className={cn('h-3.5 w-3.5', calendarConnected ? 'text-sky-400' : 'text-muted-foreground/50')} />
        {calendarConnected ? <CheckCircle2 className="h-3 w-3 text-status-green" /> : <AlertTriangle className="h-3 w-3 text-status-amber" />}
      </div>
      
      {/* Drive */}
      <div className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
        driveConnected ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-secondary/50 border border-border'
      )}>
        <FileText className={cn('h-3.5 w-3.5', driveConnected ? 'text-emerald-400' : 'text-muted-foreground/50')} />
        {driveConnected ? <CheckCircle2 className="h-3 w-3 text-status-green" /> : <AlertTriangle className="h-3 w-3 text-status-amber" />}
      </div>
      
      {disconnectedCount && disconnectedCount > 0 && (
        <span className="text-[10px] text-status-amber ml-1 font-medium">{disconnectedCount} not connected</span>
      )}
    </div>
  );
}

interface BriefingModalProps {
  isOpen: boolean;
  onClose: () => void;
  briefing: Briefing;
  providers: Record<ProviderKey, { status: string; lastSyncAt: string | null; isSyncing: boolean }>;
  globalSyncDisplay: string;
}

function BriefingModal({ isOpen, onClose, briefing, providers, globalSyncDisplay }: BriefingModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] max-h-[900px] p-0 flex flex-col bg-background border-border rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-6 py-5 border-b border-border bg-card">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/30 to-orange-500/20 rounded-2xl blur-md" />
                <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center ring-1 ring-amber-500/20">
                  <Sparkles className="h-7 w-7 text-amber-400" />
                </div>
              </div>
              <div>
                <DialogTitle className="text-xl font-bold text-foreground">Daily Strategic Briefing</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> {globalSyncDisplay}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-5">
            {(['gmail', 'calendar', 'drive'] as ProviderKey[]).map((p) => {
              const { icon: Icon, label, color, bg, border } = PROVIDERS[p];
              const isConnected = providers[p].status === 'connected';
              return (
                <div key={p} className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                  isConnected ? cn(bg, border) : 'bg-secondary/50 border border-border'
                )}>
                  <Icon className={cn('h-4 w-4', isConnected ? color : 'text-muted-foreground/50')} />
                  <span className={isConnected ? 'text-foreground' : 'text-muted-foreground/50'}>{label}</span>
                  {isConnected ? <CheckCircle2 className="h-4 w-4 text-status-green" /> : <AlertTriangle className="h-4 w-4 text-status-amber" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 eos-scrollbar">
          {/* Executive Summary */}
          <div className="p-5 bg-card rounded-xl border border-border">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-teal flex items-center justify-center shrink-0 ring-1 ring-primary/20">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h4 className="text-base font-semibold text-foreground mb-2">Executive Summary</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">{briefing.summary}</p>
              </div>
            </div>
          </div>

          {/* Key Priorities */}
          {briefing.key_priorities && briefing.key_priorities.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-400" /> Key Priorities
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {briefing.key_priorities.map((priority, i) => (
                  <div key={i} className="p-5 bg-gradient-copper border border-ai-copper/20 rounded-xl">
                    <div className="flex items-start gap-3">
                      <div className={cn('priority-badge shrink-0', i === 0 ? 'priority-badge-1' : i === 1 ? 'priority-badge-2' : 'priority-badge-3')}>
                        {i + 1}
                      </div>
                      <div>
                        <h5 className="font-semibold text-sm text-foreground mb-1">{priority.title}</h5>
                        <p className="text-sm text-muted-foreground leading-relaxed">{priority.description}</p>
                        {priority.source && <p className="text-xs text-muted-foreground/60 mt-2">Source: {priority.source}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Schedule Overview */}
          {briefing.schedule_summary && (
            <div className="p-5 bg-card rounded-xl border border-border">
              <h4 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-sky-400" /> Schedule Overview
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-5 bg-secondary/50 rounded-xl text-center">
                  <div className="text-3xl font-bold text-foreground">{briefing.schedule_summary?.key_meetings?.length || 0}</div>
                  <div className="text-sm text-muted-foreground mt-1">Key Meetings</div>
                </div>
                <div className="p-5 bg-secondary/50 rounded-xl text-center">
                  <div className={cn('text-3xl font-bold', (briefing.schedule_summary?.conflicts?.length || 0) > 0 ? 'text-status-amber' : 'text-status-green')}>
                    {briefing.schedule_summary?.conflicts?.length || 0}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Conflicts</div>
                </div>
              </div>
            </div>
          )}

          {briefing.content && (
            <div className="p-5 bg-card rounded-xl border border-border">
              <h4 className="text-base font-semibold text-foreground mb-3">Detailed Analysis</h4>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{briefing.content}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-between bg-card">
          <p className="text-xs text-muted-foreground">Data: 24h emails · 7 days calendar · 48h documents</p>
          <Button onClick={onClose} className="font-medium">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
