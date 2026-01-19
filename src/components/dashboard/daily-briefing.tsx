'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { 
  RefreshCw, 
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
import { toast } from 'sonner';
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
  gmail: { icon: Mail, label: 'Gmail', color: 'text-red-400', bg: 'bg-red-500/20' },
  calendar: { icon: Calendar, label: 'Calendar', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  drive: { icon: FileText, label: 'Drive', color: 'text-green-400', bg: 'bg-green-500/20' },
};

export function DailyBriefingWidget() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Use centralized sync manager - displayStrings.global shows when ALL sources synced
  const { providers, syncAll, displayStrings } = useSyncManager();

  // DEBUG: Log providers on every render
  console.log('[DailyBriefingWidget] providers from SyncManager:', JSON.stringify({
    gmail: providers.gmail?.status,
    calendar: providers.calendar?.status,
    drive: providers.drive?.status,
  }));

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

  const handleRefresh = async () => {
    if (connectedProviders.length === 0) {
      toast.warning('No sources connected');
      return;
    }
    setIsRefreshing(true);
    toast.info('Syncing data and generating briefing...');

    try {
      // Use centralized sync (queues all connected providers)
      await syncAll();

      // Wait for sync to process
      await new Promise((r) => setTimeout(r, 3000));

      // Generate briefing
      const response = await fetch('/api/ai/briefing/generate', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      
      if (data?.success) {
        // Poll for briefing
        let attempts = 0;
        const poll = async () => {
          attempts++;
          await fetchBriefing();
          if (attempts >= 10 || briefing?.id) return;
          await new Promise((r) => setTimeout(r, 2000));
          return poll();
        };
        await poll();
        toast.success('Briefing updated');
      } else {
        toast.warning(data?.error || 'Briefing queued');
      }
    } catch (error) {
      toast.error('Failed to generate briefing', { description: error instanceof Error ? error.message : 'Error' });
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!isLoaded || isLoading) {
    return (
      <Card className="p-5 h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
        <div className="space-y-3 flex-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      </Card>
    );
  }

  // All disconnected
  if (connectedProviders.length === 0) {
    return (
      <Card className="p-5 h-full flex flex-col">
        {/* Header with refresh button (disabled) */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center ring-1 ring-amber-500/20">
              <Sparkles className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Daily Briefing</h3>
              <p className="text-xs text-gray-500">No sources connected</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" disabled className="h-8 w-8 p-0 opacity-30">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Content */}
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center mb-4 ring-1 ring-amber-500/20">
            <Sparkles className="h-7 w-7 text-amber-400" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Daily Strategic Briefing</h3>
          <p className="text-sm text-gray-400 max-w-sm mb-5">
            Connect data sources to generate AI briefings from emails, calendar, and documents.
          </p>
          <div className="flex items-center gap-2 mb-5">
            {(['gmail', 'calendar', 'drive'] as ProviderKey[]).map((p) => {
              const { icon: Icon, label, color } = PROVIDERS[p];
              return (
                <div key={p} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800/60 rounded-lg border border-gray-700/50">
                  <Icon className={cn('h-3.5 w-3.5', color)} />
                  <span className="text-xs text-gray-400">{label}</span>
                </div>
              );
            })}
          </div>
          <Button onClick={() => router.push('/settings')} className="bg-teal-500 hover:bg-teal-600">
            Connect Accounts
          </Button>
        </div>
      </Card>
    );
  }

  // No briefing yet
  if (!briefing) {
  return (
      <Card className="p-5 h-full flex flex-col">
        <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center ring-1 ring-amber-500/20">
              <Sparkles className="h-5 w-5 text-amber-400" />
          </div>
          <div>
              <h3 className="text-base font-bold text-white">Daily Briefing</h3>
              <p className="text-xs text-gray-500">{connectedProviders.length} source{connectedProviders.length !== 1 ? 's' : ''} connected</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefreshing} className="h-8 w-8 p-0">
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
          </Button>
        </div>
        <SourcePills providers={providers} />
        <div className="flex-1 flex flex-col items-center justify-center py-6">
          <p className="text-sm text-gray-400 mb-4">No briefing yet for today.</p>
          <Button onClick={handleRefresh} disabled={isRefreshing} className="bg-amber-500 hover:bg-amber-600">
            {isRefreshing ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Generating...</> : <><Sparkles className="mr-2 h-4 w-4" />Generate Briefing</>}
          </Button>
        </div>
      </Card>
    );
  }

  // Has briefing
  return (
    <>
      <Card className="p-5 h-full flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center ring-1 ring-amber-500/20">
              <Sparkles className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Daily Briefing</h3>
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Clock className="h-3 w-3" />
                {displayStrings.global}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefreshing} className="h-8 w-8 p-0">
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
        </Button>
      </div>

        {/* Source pills */}
        <SourcePills providers={providers} disconnectedCount={disconnectedProviders.length} />

        {/* Summary */}
        <p className="text-sm text-gray-300 leading-relaxed line-clamp-3 mb-4">
            {briefing.summary}
          </p>

        {/* Key Priorities */}
        {briefing.key_priorities && briefing.key_priorities.length > 0 && (
          <div className="flex-1 space-y-2 overflow-y-auto mb-3">
            {briefing.key_priorities.slice(0, 3).map((priority, i) => (
              <div key={i} className="flex gap-2.5 p-3 rounded-lg bg-gray-800/40 hover:bg-gray-800/60 transition-colors">
                <div className="h-5 w-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-amber-400">{i + 1}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm text-white truncate">{priority.title}</p>
                  <p className="text-xs text-gray-500 line-clamp-1">{priority.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="pt-3 border-t border-gray-800/50 flex items-center justify-end">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-gray-400 hover:text-white" onClick={() => setShowModal(true)}>
            View Full Briefing <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </Card>

      <BriefingModal 
        isOpen={showModal} 
        onClose={() => setShowModal(false)} 
        briefing={briefing} 
        providers={providers} 
        onRefresh={handleRefresh} 
        isRefreshing={isRefreshing}
        globalSyncDisplay={displayStrings.global}
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
  // DEBUG: Log what providers we're receiving
  console.log('[SourcePills] providers:', JSON.stringify({
    gmail: providers.gmail?.status,
    calendar: providers.calendar?.status,
    drive: providers.drive?.status,
  }));
  
  // CRITICAL: Directly compute connected status for each provider
  const gmailConnected = providers.gmail?.status === 'connected';
  const calendarConnected = providers.calendar?.status === 'connected';
  const driveConnected = providers.drive?.status === 'connected';
  
  console.log('[SourcePills] Connected status - Gmail:', gmailConnected, 'Calendar:', calendarConnected, 'Drive:', driveConnected);
  
  return (
    <div className="flex items-center gap-1.5 mb-3">
      {/* Gmail */}
      <div className={cn('flex items-center gap-1 px-2 py-1 rounded-md text-xs', gmailConnected ? 'bg-red-500/20' : 'bg-gray-800/50')}>
        <Mail className={cn('h-3 w-3', gmailConnected ? 'text-red-400' : 'text-gray-500')} />
        {gmailConnected ? <CheckCircle2 className="h-2.5 w-2.5 text-green-400" /> : <AlertTriangle className="h-2.5 w-2.5 text-amber-400" />}
      </div>
      
      {/* Calendar */}
      <div className={cn('flex items-center gap-1 px-2 py-1 rounded-md text-xs', calendarConnected ? 'bg-blue-500/20' : 'bg-gray-800/50')}>
        <Calendar className={cn('h-3 w-3', calendarConnected ? 'text-blue-400' : 'text-gray-500')} />
        {calendarConnected ? <CheckCircle2 className="h-2.5 w-2.5 text-green-400" /> : <AlertTriangle className="h-2.5 w-2.5 text-amber-400" />}
      </div>
      
      {/* Drive */}
      <div className={cn('flex items-center gap-1 px-2 py-1 rounded-md text-xs', driveConnected ? 'bg-green-500/20' : 'bg-gray-800/50')}>
        <FileText className={cn('h-3 w-3', driveConnected ? 'text-green-400' : 'text-gray-500')} />
        {driveConnected ? <CheckCircle2 className="h-2.5 w-2.5 text-green-400" /> : <AlertTriangle className="h-2.5 w-2.5 text-amber-400" />}
      </div>
      
      {disconnectedCount && disconnectedCount > 0 && <span className="text-[10px] text-amber-400 ml-1">{disconnectedCount} not connected</span>}
    </div>
  );
}

interface BriefingModalProps {
  isOpen: boolean;
  onClose: () => void;
  briefing: Briefing;
  providers: Record<ProviderKey, { status: string; lastSyncAt: string | null; isSyncing: boolean }>;
  onRefresh: () => void;
  isRefreshing: boolean;
  globalSyncDisplay: string;
}

function BriefingModal({ isOpen, onClose, briefing, providers, onRefresh, isRefreshing, globalSyncDisplay }: BriefingModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] max-h-[900px] p-0 flex flex-col bg-white dark:bg-[#0d1117] border-gray-200 dark:border-[#30363d]">
        {/* Header */}
        <div className="shrink-0 px-6 py-5 border-b border-gray-200 dark:border-[#30363d]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500/30 to-orange-500/20 flex items-center justify-center ring-1 ring-amber-500/30">
                <Sparkles className="h-6 w-6 text-amber-400" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white">Daily Strategic Briefing</DialogTitle>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 flex items-center gap-1.5">
                <Clock className="h-3 w-3" /> {globalSyncDisplay}
              </span>
              <Button variant="ghost" size="sm" onClick={onRefresh} disabled={isRefreshing} className="h-8 w-8 p-0">
                <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            {(['gmail', 'calendar', 'drive'] as ProviderKey[]).map((p) => {
              const { icon: Icon, label, color, bg } = PROVIDERS[p];
              const isConnected = providers[p].status === 'connected';
              return (
                <div key={p} className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm', isConnected ? bg : 'bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50')}>
                  <Icon className={cn('h-3.5 w-3.5', isConnected ? color : 'text-gray-400 dark:text-gray-500')} />
                  <span className={isConnected ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}>{label}</span>
                  {isConnected ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Executive Summary */}
          <div className="p-5 bg-gray-50 dark:bg-[#161b22] rounded-xl border border-gray-200 dark:border-[#30363d]">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-teal-500/20 flex items-center justify-center shrink-0">
                <Target className="h-4 w-4 text-teal-500" />
              </div>
              <div>
                <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Executive Summary</h4>
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{briefing.summary}</p>
              </div>
            </div>
          </div>

          {/* Key Priorities */}
          {briefing.key_priorities && briefing.key_priorities.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" /> Key Priorities
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {briefing.key_priorities.map((priority, i) => (
                  <div key={i} className="p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                    <div className="flex items-start gap-3">
                      <div className="h-7 w-7 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-amber-600 dark:text-amber-400">{i + 1}</span>
                      </div>
                      <div>
                        <h5 className="font-semibold text-sm text-gray-900 dark:text-white mb-1">{priority.title}</h5>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{priority.description}</p>
                        {priority.source && <p className="text-xs text-gray-500 mt-1.5">Source: {priority.source}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Schedule Overview */}
          {briefing.schedule_summary && (
            <div className="p-5 bg-gray-50 dark:bg-[#161b22] rounded-xl border border-gray-200 dark:border-[#30363d]">
              <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-500" /> Schedule Overview
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-white dark:bg-gray-800/50 rounded-lg text-center">
                  <div className="text-3xl font-bold text-gray-900 dark:text-white">{briefing.schedule_summary?.key_meetings?.length || 0}</div>
                  <div className="text-sm text-gray-500">Key Meetings</div>
                </div>
                <div className="p-4 bg-white dark:bg-gray-800/50 rounded-lg text-center">
                  <div className={cn('text-3xl font-bold', (briefing.schedule_summary?.conflicts?.length || 0) > 0 ? 'text-amber-500' : 'text-green-500')}>
                    {briefing.schedule_summary?.conflicts?.length || 0}
                  </div>
                  <div className="text-sm text-gray-500">Conflicts</div>
                </div>
              </div>
            </div>
          )}

          {briefing.content && (
            <div className="p-5 bg-gray-50 dark:bg-[#161b22] rounded-xl border border-gray-200 dark:border-[#30363d]">
              <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-3">Detailed Analysis</h4>
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{briefing.content}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-200 dark:border-[#30363d] px-6 py-4 flex items-center justify-between bg-gray-50 dark:bg-[#0d1117]/80">
          <p className="text-xs text-gray-500">Data: 24h emails · 7 days calendar · 48h documents</p>
          <Button onClick={onClose}>Close</Button>
      </div>
      </DialogContent>
    </Dialog>
  );
}
