'use client';

/**
 * EmergentOS - Daily Briefing Widget
 * 
 * AI-powered executive briefing synthesizing emails, calendar, and documents.
 * Design: Warm amber theme with compact dashboard view + detailed modal.
 * 
 * DISTINCT FROM Schedule Widget:
 * - Amber/orange color scheme (vs sky/violet)
 * - Newspaper icon (vs Calendar)
 * - Horizontal priority cards (vs vertical event list)
 * - Compact summary focus (vs event-by-event list)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { 
  Newspaper,
  Sparkles, 
  Mail, 
  Calendar, 
  FileText,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Zap,
  Target,
  Clock,
  AlertCircle,
  Lightbulb,
  X,
  ChevronRight,
  ArrowRight,
  Circle,
  Flame,
  Activity,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSyncManager, type ProviderKey } from '@/lib/sync-manager';
import { getCurrentUTCDate, formatTimeAgo, formatTimeBlock } from '@/lib/time';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

// ============================================================================
// Types
// ============================================================================

interface BriefingContent {
  executiveSummary: string;
  briefingScore?: number;
  briefingVerdict?: 'CLEAR' | 'MANAGEABLE' | 'BUSY' | 'OVERLOADED';
  topPriority: {
    item: string;
    reason: string;
    suggestedAction: string;
    alignsWithGoal?: boolean;
  };
  urgentAttention: Array<{
    type: 'EMAIL' | 'MEETING' | 'DOCUMENT' | 'CONFLICT';
    item: string;
    action: string;
    deadline?: string;
    priority?: number;
  }>;
  scheduleInsight: {
    meetingCount: number;
    totalMeetingHours: number;
    conflictCount: number;
    nextMeeting?: string | null;
    minutesUntilNext?: number | null;
    freeBlocks: string[];
    recommendation: string;
  };
  actionItems: Array<{
    task: string;
    source: 'EMAIL' | 'CALENDAR' | 'DRIVE' | 'ANALYSIS';
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    canDelegate?: boolean;
    delegateTo?: string;
    estimatedMinutes?: number;
  }>;
  intelligence?: {
    emailHighlights?: string[];
    documentActivity?: string[];
    patterns?: string[];
  };
  personalizedInsights?: Array<{
    category: 'GOAL_PROGRESS' | 'BLOCKER_ALERT' | 'ENERGY_TIP' | 'DECISION_NEEDED';
    insight: string;
    recommendation: string;
  }>;
  metrics?: {
    emailsToProcess?: number;
    urgentEmailCount?: number;
    meetingsToday?: number;
    conflictsDetected?: number;
    documentsUpdated?: number;
  };
  closingNote: string;
}

interface Briefing {
  id: string;
  user_id: string;
  briefing_date: string;
  content: BriefingContent;
  generated_at: string;
}

// ============================================================================
// Main Component
// ============================================================================

export function DailyBriefingWidget() {
  const { isLoaded, user } = useUser();
  const router = useRouter();
  const { providers, isSyncing, isInitialized } = useSyncManager();

  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const connectedProviders = useMemo(() => 
    (['gmail', 'calendar', 'drive'] as ProviderKey[]).filter((p) => providers[p].status === 'connected'),
    [providers]
  );
  
  const hasConnections = connectedProviders.length > 0;

  // Get the most recent sync time from all connected providers
  // This shows "data freshness" rather than "briefing generation time"
  const mostRecentSyncTime = useMemo(() => {
    let mostRecent: string | null = null;
    for (const key of connectedProviders) {
      const syncAt = providers[key].lastSyncAt;
      if (syncAt) {
        if (!mostRecent || new Date(syncAt) > new Date(mostRecent)) {
          mostRecent = syncAt;
        }
      }
    }
    return mostRecent;
  }, [providers, connectedProviders]);

  // ============================================================================
  // Fetch Briefing
  // ============================================================================

  const fetchBriefing = useCallback(async (skipLoadingState = false) => {
    if (!user?.id || !hasConnections) {
      setIsLoading(false);
      return;
    }

    if (!skipLoadingState) {
    setIsLoading(true);
    }

    try {
      const today = getCurrentUTCDate();
      // CRITICAL: Add cache-busting timestamp to prevent stale data
      const cacheBuster = Date.now();
      const response = await fetch(`/api/ai/briefing/${today}?_t=${cacheBuster}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.found && data.content) {
          setBriefing({
            id: data.briefingId,
            user_id: user.id,
            briefing_date: data.briefingDate,
            content: data.content,
            generated_at: data.generatedAt,
          });
          setError(null);
        } else {
          setBriefing(null);
        }
      } else if (response.status === 404) {
        setBriefing(null);
      } else {
        setError('Failed to load briefing');
      }
    } catch (err) {
      console.error('[DailyBriefing] Fetch error:', err);
      setError('Failed to load briefing');
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, hasConnections]);

  // ============================================================================
  // Generate Briefing
  // ============================================================================

  const handleGenerateBriefing = async () => {
    if (!hasConnections) return;

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/ai/briefing/generate', {
        method: 'POST',
      });

      if (response.ok) {
        await fetchBriefing();
      } else {
        setError('Failed to generate briefing');
      }
    } catch (err) {
      console.error('[DailyBriefing] Generate error:', err);
      setError('Failed to generate briefing');
    } finally {
      setIsGenerating(false);
    }
  };

  // ============================================================================
  // Effects
  // ============================================================================

  useEffect(() => {
    if (isLoaded && user?.id) {
      fetchBriefing();
    }
  }, [isLoaded, user?.id, fetchBriefing]);

  // CRITICAL FIX: Always refresh briefing after ANY sync completion
  // Previously only refreshed when briefingRegenerated === true, which caused stale timestamps
  useEffect(() => {
    const handleConnectionsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent;
      const detail = customEvent.detail;
      
      // Refresh on ANY sync completion, not just when briefingRegenerated is true
      // This ensures the timestamp is always current after manual syncs
      if (detail?.phase === 'complete') {
        // Use skipLoadingState=true for background refreshes to avoid UI flicker
        fetchBriefing(true);
      }
    };

    window.addEventListener('eos:connections-updated', handleConnectionsUpdated);
    return () => {
      window.removeEventListener('eos:connections-updated', handleConnectionsUpdated);
    };
  }, [fetchBriefing]);

  // ============================================================================
  // Render States
  // ============================================================================

  if (!isLoaded || !isInitialized) {
    return <BriefingLoadingSkeleton />;
  }

  if (!hasConnections) {
    return <NoConnectionsState onConnect={() => router.push('/settings')} />;
  }

  if (isLoading) {
    return <BriefingLoadingSkeleton />;
  }

  if (error) {
    return (
      <Card className="h-full flex flex-col overflow-hidden border bg-card shadow-sm">
        <BriefingWidgetHeader />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-[280px]">
            <div className="mx-auto w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center mb-4">
              <AlertCircle className="h-6 w-6 text-red-400" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">Error Loading Briefing</h3>
            <p className="text-xs text-muted-foreground mb-4">{error}</p>
            <Button onClick={() => fetchBriefing()} variant="outline" size="sm" className="h-8 text-xs">
              <RefreshCw className="h-3 w-3 mr-2" />
              Retry
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (!briefing) {
    return (
      <Card className="h-full flex flex-col overflow-hidden border bg-card shadow-sm">
        <BriefingWidgetHeader />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-[280px]">
            <div className="relative mx-auto w-14 h-14 mb-4">
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 to-orange-500/10 rounded-xl blur-lg" />
              <div className="relative h-full w-full rounded-xl bg-gradient-to-br from-amber-500/15 to-orange-500/10 flex items-center justify-center ring-1 ring-amber-500/20">
                <Sparkles className="h-6 w-6 text-amber-500" />
              </div>
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">No Briefing Yet</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Generate your AI-powered briefing for strategic insights.
            </p>
            <Button 
              onClick={handleGenerateBriefing} 
              disabled={isGenerating || isSyncing}
              size="sm"
              className="h-8 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0 shadow-lg shadow-amber-500/20"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-2" />
                  Generate Briefing
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // ============================================================================
  // Main Briefing Display - Horizontal Dashboard View
  // ============================================================================

  const content = briefing.content;
  const briefingScore = content.briefingScore ?? 75;
  const briefingVerdict = content.briefingVerdict;
  const conflictCount = content.scheduleInsight?.conflictCount ?? content.metrics?.conflictsDetected ?? 0;
  const meetingCount = content.scheduleInsight?.meetingCount ?? content.metrics?.meetingsToday ?? 0;
  const emailCount = content.metrics?.emailsToProcess ?? 0;
  const urgentCount = (content.metrics?.urgentEmailCount ?? 0) + (content.urgentAttention?.length ?? 0);

  // Get top 3 action items for dashboard display
  const displayActions = content.actionItems?.slice(0, 3) ?? [];

  return (
    <>
      <Card className="h-full flex flex-col overflow-hidden border bg-card shadow-sm transition-all duration-200 hover:shadow-md">
        {/* Header */}
        <BriefingWidgetHeader 
          onOpenDetail={() => setIsDetailModalOpen(true)}
          hasContent={true}
        />

        {/* Main Content - Clickable */}
        <button
          onClick={() => setIsDetailModalOpen(true)}
          className="flex-1 flex flex-col text-left group min-h-0 overflow-hidden"
        >
          {/* Stats Bar */}
          <div className="flex items-center gap-3 px-5 py-2.5 bg-secondary/30 border-b border-border/30">
            {/* Score Circle */}
            <div className="relative shrink-0">
              <svg className="w-10 h-10 -rotate-90">
                <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3" className="text-secondary" />
                <circle
                  cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3"
                  strokeDasharray={`${(briefingScore / 100) * 100.5} 100.5`}
                  strokeLinecap="round"
                  className={cn(
                    briefingScore >= 80 ? 'text-emerald-500' :
                    briefingScore >= 60 ? 'text-amber-500' :
                    briefingScore >= 40 ? 'text-orange-500' : 'text-red-500'
                  )}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={cn(
                  'text-xs font-bold',
                  briefingScore >= 80 ? 'text-emerald-500' :
                  briefingScore >= 60 ? 'text-amber-500' :
                  briefingScore >= 40 ? 'text-orange-500' : 'text-red-500'
                )}>
                  {briefingScore}
                </span>
              </div>
            </div>

            {/* Verdict Badge */}
            <span className={cn(
              'text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide',
              briefingVerdict === 'CLEAR' && 'bg-emerald-500/15 text-emerald-500',
              briefingVerdict === 'MANAGEABLE' && 'bg-amber-500/15 text-amber-500',
              briefingVerdict === 'BUSY' && 'bg-orange-500/15 text-orange-500',
              briefingVerdict === 'OVERLOADED' && 'bg-red-500/15 text-red-500'
            )}>
              {briefingVerdict}
            </span>

            {/* Divider */}
            <div className="w-px h-4 bg-border/50" />

            {/* Stats */}
            <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {meetingCount}
              </span>
              <span className="flex items-center gap-1">
                <Mail className="w-3.5 h-3.5" />
                {emailCount}
              </span>
              {conflictCount > 0 && (
                <span className="flex items-center gap-1 text-red-500 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {conflictCount}
                </span>
              )}
              {urgentCount > 0 && (
                <span className="flex items-center gap-1 text-amber-500 font-medium">
                  <Flame className="w-3.5 h-3.5" />
                  {urgentCount}
                </span>
              )}
            </div>

            {/* Timestamp */}
            {mostRecentSyncTime && (
              <span className="ml-auto text-[11px] text-muted-foreground/70 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatTimeAgo(mostRecentSyncTime)}
              </span>
            )}
          </div>

          {/* Two-Column Content */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Left Column - Summary + Priority + Schedule Info */}
            <div className="flex-1 flex flex-col gap-3 p-5 min-w-0 overflow-hidden">
              {/* Executive Summary */}
              <div className="shrink-0">
                <p className="text-sm text-foreground/80 leading-relaxed line-clamp-4 group-hover:text-foreground transition-colors">
                  {content.executiveSummary}
                </p>
              </div>

              {/* Top Priority */}
              {content.topPriority && (
                <div className="bg-gradient-to-r from-amber-500/10 to-transparent rounded-lg px-4 py-2.5 border-l-2 border-amber-500 shrink-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Target className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500">
                      Top Priority
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-foreground line-clamp-1">
                    {content.topPriority.item}
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                    {content.topPriority.suggestedAction}
                  </p>
                </div>
              )}

              {/* Schedule Tip */}
              {content.scheduleInsight?.recommendation && (
                <div className="bg-secondary/30 rounded-lg px-4 py-2.5 shrink-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Lightbulb className="w-3.5 h-3.5 text-sky-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-500">
                      Schedule Tip
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {content.scheduleInsight.recommendation}
                  </p>
                </div>
              )}

              {/* Free Blocks */}
              {content.scheduleInsight?.freeBlocks && content.scheduleInsight.freeBlocks.length > 0 && (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Free:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {content.scheduleInsight.freeBlocks.slice(0, 3).map((block, idx) => (
                      <span key={idx} className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-medium">
                        {formatTimeBlock(block)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Spacer */}
              <div className="flex-1" />
            </div>

            {/* Right Column - Actions + Urgent */}
            <div className="w-[200px] shrink-0 border-l border-border/30 p-4 flex flex-col gap-3 overflow-hidden">
              {/* Actions */}
              {displayActions.length > 0 && (
                <div className="shrink-0">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-[10px] font-bold text-foreground uppercase tracking-wider">
                      Actions
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {displayActions.map((item, idx) => (
                      <div 
                        key={idx} 
                        className="flex items-start gap-2 p-2 rounded-md bg-secondary/40 group-hover:bg-secondary/60 transition-colors"
                      >
                        <div className={cn(
                          'w-1.5 h-1.5 rounded-full shrink-0 mt-1.5',
                          item.priority === 'HIGH' ? 'bg-red-500' :
                          item.priority === 'MEDIUM' ? 'bg-amber-500' : 'bg-muted-foreground'
                        )} />
                        <p className="text-xs text-foreground line-clamp-2 leading-snug">{item.task}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Urgent Attention */}
              {content.urgentAttention && content.urgentAttention.length > 0 && (
                <div className="shrink-0">
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-[10px] font-bold text-foreground uppercase tracking-wider">
                      Urgent
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {content.urgentAttention.slice(0, 2).map((item, idx) => (
                      <div 
                        key={idx} 
                        className="p-2 rounded-md bg-red-500/10 border border-red-500/20"
                      >
                        <p className="text-xs text-foreground line-clamp-1 font-medium">{item.item}</p>
                        <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{item.action}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Spacer */}
              <div className="flex-1" />
            </div>
          </div>
        </button>
      </Card>

      {/* Detail Modal */}
      <BriefingDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        briefing={briefing}
      />
    </>
  );
}

// ============================================================================
// Header Component - Clean, Minimal
// ============================================================================

function BriefingWidgetHeader({ 
  onOpenDetail,
  hasContent,
}: { 
  onOpenDetail?: () => void;
  hasContent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/10 text-amber-500">
          <Newspaper className="w-4.5 h-4.5" />
        </div>
        <h3 className="text-base font-semibold tracking-tight text-foreground">Daily Briefing</h3>
      </div>
      
      {hasContent && onOpenDetail && (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail();
          }}
          className="h-7 px-2.5 text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
        >
          View Details
          <ChevronRight className="w-3.5 h-3.5 ml-1" />
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// Loading & Empty States
// ============================================================================

function BriefingLoadingSkeleton() {
  return (
    <Card className="h-full flex flex-col overflow-hidden border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-5 w-28" />
        </div>
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>
      {/* Stats Bar */}
      <div className="flex items-center gap-3 px-5 py-2.5 bg-secondary/30 border-b border-border/30">
        <Skeleton className="h-10 w-10 rounded-full" />
        <Skeleton className="h-5 w-16 rounded" />
        <div className="w-px h-4 bg-border/50" />
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-4 w-8" />
          <Skeleton className="h-4 w-8" />
        </div>
        <Skeleton className="h-4 w-16 ml-auto" />
      </div>
      {/* Two-Column Content */}
      <div className="flex-1 flex min-h-0">
        {/* Left Column */}
        <div className="flex-1 flex flex-col gap-4 p-5">
          <Skeleton className="h-[88px] w-full rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        {/* Right Column */}
        <div className="w-[220px] border-l border-border/30 p-4">
          <Skeleton className="h-4 w-20 mb-3" />
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </Card>
  );
}

function NoConnectionsState({ onConnect }: { onConnect: () => void }) {
  return (
    <Card className="h-full flex flex-col overflow-hidden border bg-card shadow-sm">
      <BriefingWidgetHeader />
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-[280px]">
          <div className="relative mx-auto w-14 h-14 mb-4">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 to-orange-500/10 rounded-xl blur-lg" />
            <div className="relative h-full w-full rounded-xl bg-gradient-to-br from-amber-500/15 to-orange-500/10 flex items-center justify-center ring-1 ring-amber-500/20">
              <Newspaper className="h-6 w-6 text-amber-500" />
            </div>
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">Connect Your Sources</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Link email, calendar, and drive to generate AI briefings.
          </p>
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="p-2 rounded-lg bg-secondary/50 border border-border/50">
              <Mail className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="p-2 rounded-lg bg-secondary/50 border border-border/50">
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="p-2 rounded-lg bg-secondary/50 border border-border/50">
              <FileText className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
          <Button 
            onClick={onConnect} 
            size="sm"
            className="h-8 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0 shadow-lg shadow-amber-500/20"
          >
            Connect Sources
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ============================================================================
// Detail Modal - Full Briefing View
// ============================================================================

function BriefingDetailModal({
  isOpen,
  onClose,
  briefing,
}: {
  isOpen: boolean;
  onClose: () => void;
  briefing: Briefing | null;
}) {
  if (!briefing) return null;

  const content = briefing.content;
  const briefingScore = content.briefingScore ?? 75;
  const briefingVerdict = content.briefingVerdict;
  const conflictCount = content.scheduleInsight?.conflictCount ?? content.metrics?.conflictsDetected ?? 0;

  const scoreColor = briefingScore >= 80 ? 'text-emerald-500' : 
                     briefingScore >= 60 ? 'text-amber-500' : 
                     briefingScore >= 40 ? 'text-orange-500' : 
                     'text-red-500';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        showCloseButton={false}
        className="max-w-[1100px] w-[92vw] h-[85vh] max-h-[800px] p-0 flex flex-col bg-[#0c1117] border-2 border-amber-500/30 shadow-[0_0_50px_rgba(245,158,11,0.1)] rounded-2xl overflow-hidden gap-0"
      >
        {/* Header */}
        <div className="shrink-0 px-6 py-5 border-b border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-transparent to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500/25 to-orange-500/15 border border-amber-500/30 text-amber-500 shadow-lg shadow-amber-500/10">
                <Newspaper className="w-5 h-5" />
              </div>
              <div className="flex items-center gap-3">
                <DialogTitle className="text-xl font-semibold tracking-tight text-foreground">
                  Daily Briefing
                </DialogTitle>
                {briefingVerdict && (
                  <span className={cn(
                    'text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider',
                    briefingVerdict === 'CLEAR' && 'bg-emerald-500/15 text-emerald-500',
                    briefingVerdict === 'MANAGEABLE' && 'bg-amber-500/15 text-amber-500',
                    briefingVerdict === 'BUSY' && 'bg-orange-500/15 text-orange-500',
                    briefingVerdict === 'OVERLOADED' && 'bg-red-500/15 text-red-500'
                  )}>
                    {briefingVerdict}
                  </span>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-9 w-9 rounded-lg bg-secondary/80 hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 space-y-6 overflow-y-auto bg-secondary/5 eos-scrollbar">
          {/* Metrics Grid */}
          <div className="bg-card/80 rounded-2xl border border-border/50 shadow-lg p-1.5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {/* Score */}
              <div className={cn(
                'flex flex-col justify-between p-4 rounded-xl border bg-card/50 transition-colors',
                briefingScore >= 80 ? 'border-emerald-500/20 bg-emerald-500/5' : 
                briefingScore >= 60 ? 'border-amber-500/20 bg-amber-500/5' :
                briefingScore >= 40 ? 'border-orange-500/20 bg-orange-500/5' :
                'border-red-500/20 bg-red-500/5'
              )}>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Day Score</p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="flex items-center justify-center w-4 h-4 rounded-full bg-muted/50 hover:bg-muted text-muted-foreground/70 hover:text-muted-foreground transition-colors">
                        <Info className="w-3 h-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent 
                      side="right" 
                      sideOffset={8}
                      className="max-w-[260px] p-3 bg-popover border border-border/50 shadow-xl"
                    >
                      <p className="text-xs font-semibold text-foreground mb-2">Score Calculation</p>
                      <div className="space-y-1 text-[11px] text-muted-foreground">
                        <p><span className="text-red-400">−</span> conflicts detected</p>
                        <p><span className="text-red-400">−</span> high meeting load</p>
                        <p><span className="text-amber-400">−</span> urgent emails pending</p>
                        <p><span className="text-emerald-400">+</span> available free blocks</p>
                      </div>
                      <div className="mt-2 pt-2 border-t border-border/30 text-[10px] text-muted-foreground/70">
                        100 = Clear day • 0 = Overloaded
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className={cn('text-3xl font-bold tracking-tight mt-1', scoreColor)}>
                  {briefingScore}<span className="text-sm font-medium text-muted-foreground/60 ml-1">/100</span>
                </p>
              </div>

              {/* Conflicts */}
              <div className={cn(
                'flex flex-col justify-between p-4 rounded-xl border transition-colors',
                conflictCount > 0 ? 'border-red-500/30 bg-red-500/10 ring-1 ring-red-500/20' : 'border-emerald-500/20 bg-emerald-500/5'
              )}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Conflicts</p>
                <div className="flex items-center gap-2 mt-1">
                  {conflictCount > 0 && <AlertTriangle className="w-5 h-5 text-red-500" />}
                  <p className={cn('text-3xl font-bold tracking-tight', conflictCount > 0 ? 'text-red-500' : 'text-emerald-500')}>
                    {conflictCount}
                  </p>
                </div>
              </div>

              {/* Meetings */}
              <div className="flex flex-col justify-between p-4 rounded-xl border bg-card shadow-sm">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Meetings</p>
                <p className="text-2xl font-bold tracking-tight text-foreground mt-1">
                  {content.scheduleInsight?.meetingCount ?? content.metrics?.meetingsToday ?? 0}
                </p>
              </div>

              {/* Meeting Hours */}
              <div className="flex flex-col justify-between p-4 rounded-xl border bg-card shadow-sm">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Meeting Hours</p>
                <p className="text-2xl font-bold tracking-tight text-foreground mt-1">
                  {(content.scheduleInsight?.totalMeetingHours || 0).toFixed(1)}<span className="text-sm font-medium text-muted-foreground ml-1">h</span>
                </p>
              </div>

              {/* Emails */}
              <div className="flex flex-col justify-between p-4 rounded-xl border bg-card shadow-sm">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Emails</p>
                <p className="text-2xl font-bold tracking-tight text-foreground mt-1">
                  {content.metrics?.emailsToProcess ?? 0}
                  {(content.metrics?.urgentEmailCount ?? 0) > 0 && (
                    <span className="text-xs font-medium text-red-500 ml-1">({content.metrics?.urgentEmailCount} urgent)</span>
                  )}
                </p>
              </div>
            </div>
            {/* Data Sources Period Info */}
            <div className="px-4 py-2.5 border-t border-border/30 bg-secondary/30 rounded-b-xl">
              <p className="text-[11px] text-muted-foreground text-center">
                <span className="text-amber-400/80 font-medium">Data sources:</span>{' '}
                Emails (last 24h) • Calendar (today + tomorrow) • Documents (last 24h)
              </p>
            </div>
          </div>

          {/* Executive Summary */}
          <div className="p-6 bg-card/80 rounded-2xl border border-border/50 shadow-lg">
            <h4 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
              <Activity className="w-5 h-5 text-amber-500" />
              Executive Summary
            </h4>
            <p className="text-base leading-relaxed text-muted-foreground">
              {content.executiveSummary}
            </p>
          </div>

          {/* Top Priority */}
          {content.topPriority && (
            <div className="p-6 bg-gradient-to-br from-amber-500/5 to-orange-500/5 rounded-2xl border border-amber-500/20 shadow-lg">
              <h4 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
                <Target className="w-5 h-5 text-amber-500" />
                Top Priority
              </h4>
              <div className="space-y-2">
                <p className="font-medium text-foreground">{content.topPriority.item}</p>
                <p className="text-sm text-muted-foreground">{content.topPriority.reason}</p>
                <div className="flex items-center gap-2 text-sm text-foreground mt-3 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <span>{content.topPriority.suggestedAction}</span>
                </div>
              </div>
            </div>
          )}

          {/* Urgent Attention */}
          {content.urgentAttention && content.urgentAttention.length > 0 && (
            <div className="p-6 bg-card/80 rounded-2xl border border-border/50 shadow-lg">
              <h4 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-500/10">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                </div>
                <span>Urgent Attention</span>
                <span className="ml-2 px-2 py-0.5 text-xs font-bold rounded-full bg-red-500/10 text-red-500">
                  {content.urgentAttention.length}
                </span>
              </h4>
              <div className="space-y-3">
                {content.urgentAttention.map((item, idx) => (
                  <div key={idx} className="p-4 bg-card rounded-xl border shadow-sm">
                    <div className="flex items-start gap-4">
                      <div className={cn(
                        'flex items-center justify-center w-8 h-8 rounded-lg font-bold text-sm shrink-0',
                        item.type === 'CONFLICT' ? 'bg-red-500/10 text-red-500' : 'bg-secondary text-muted-foreground'
                      )}>
                        {item.priority || idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn(
                            'text-[10px] font-medium px-1.5 py-0.5 rounded',
                            item.type === 'CONFLICT' ? 'bg-red-500/15 text-red-500' : 'bg-secondary text-muted-foreground'
                          )}>
                            {item.type}
                          </span>
                        </div>
                        <p className="font-medium text-sm text-foreground">{item.item}</p>
                        <p className="text-xs text-muted-foreground mt-1">{item.action}</p>
                        {item.deadline && (
                          <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary text-muted-foreground text-[10px] font-medium mt-2">
                            <Clock className="w-3 h-3" />
                            <span>{item.deadline}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Schedule Recommendation */}
          {content.scheduleInsight?.recommendation && (
            <div className="p-6 bg-card/80 rounded-2xl border border-border/50 shadow-lg">
              <h4 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-muted-foreground" />
                Schedule Insight
              </h4>
              <p className="text-sm text-muted-foreground mb-4">{content.scheduleInsight.recommendation}</p>
              {content.scheduleInsight.freeBlocks && content.scheduleInsight.freeBlocks.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Free Blocks</p>
                  <div className="flex flex-wrap gap-2">
                    {content.scheduleInsight.freeBlocks.map((block, idx) => (
                      <span key={idx} className="text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        {formatTimeBlock(block)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Items */}
          {content.actionItems && content.actionItems.length > 0 && (
            <div className="p-6 bg-card/80 rounded-2xl border border-border/50 shadow-lg">
              <h4 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <span>Action Items</span>
                <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-secondary text-muted-foreground">
                  {content.actionItems.length}
                </span>
              </h4>
              <div className="space-y-2">
                {content.actionItems.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-3 bg-card rounded-lg border">
                    <div className={cn(
                      'w-2 h-2 rounded-full mt-1.5 shrink-0',
                      item.priority === 'HIGH' ? 'bg-red-500' :
                      item.priority === 'MEDIUM' ? 'bg-amber-500' :
                      'bg-muted-foreground'
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">{item.task}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {item.source}
                        {item.estimatedMinutes && ` • ~${item.estimatedMinutes} min`}
                        {item.canDelegate && item.delegateTo && ` • Delegate to: ${item.delegateTo}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Intelligence */}
          {content.intelligence && (content.intelligence.emailHighlights?.length || content.intelligence.patterns?.length) && (
            <div className="p-6 bg-card/80 rounded-2xl border border-border/50 shadow-lg">
              <h4 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-amber-500" />
                Intelligence
              </h4>
              {content.intelligence.emailHighlights && content.intelligence.emailHighlights.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Email Highlights</p>
                  <ul className="space-y-1.5">
                    {content.intelligence.emailHighlights.map((highlight, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-foreground">
                        <ArrowRight className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {content.intelligence.patterns && content.intelligence.patterns.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Patterns Noticed</p>
                  <ul className="space-y-1.5">
                    {content.intelligence.patterns.map((pattern, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-foreground">
                        <Circle className="w-1.5 h-1.5 text-amber-500 mt-2 shrink-0 fill-current" />
                        <span>{pattern}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Personalized Insights */}
          {content.personalizedInsights && content.personalizedInsights.length > 0 && (
            <div className="p-6 bg-card/80 rounded-2xl border border-border/50 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-500" />
                  Personalized Insights
                </h4>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
                  Based on your profile
                </span>
              </div>
              <div className="space-y-3">
                {content.personalizedInsights.map((insight, idx) => (
                  <div key={idx} className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                        {insight.category.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-foreground mb-2">{insight.insight}</p>
                    <p className="text-xs text-muted-foreground">{insight.recommendation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Closing Note */}
          {content.closingNote && (
            <div className="p-6 bg-gradient-to-br from-amber-500/5 to-orange-500/5 rounded-2xl border border-amber-500/10">
              <p className="text-sm text-muted-foreground italic text-center">
                &ldquo;{content.closingNote}&rdquo;
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
