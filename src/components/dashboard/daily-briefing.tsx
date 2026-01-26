'use client';

/**
 * EmergentOS - Daily Briefing Widget
 * 
 * Displays AI-generated daily briefings from /api/ai/briefing/[date]
 * Listens for eos:connections-updated events to refresh content.
 */

import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Sparkles, 
  Mail, 
  Calendar, 
  FileText,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Zap,
  Target,
  Clock,
  AlertCircle,
  Lightbulb,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSyncManager, type ProviderKey } from '@/lib/sync-manager';
import { getCurrentUTCDate } from '@/lib/time';

// ============================================================================
// Types
// ============================================================================

interface BriefingContent {
  executiveSummary: string;
  topPriority: {
    item: string;
    reason: string;
    suggestedAction: string;
  };
  urgentAttention: Array<{
    type: string;
    item: string;
    action: string;
    deadline?: string;
  }>;
  scheduleInsight: {
    meetingCount: number;
    totalMeetingHours: number;
    nextMeeting?: string;
    minutesUntilNext?: number;
    conflicts: string[];
    freeBlocks: string[];
  };
  actionItems: Array<{
    task: string;
    source: string;
    priority: string;
    canDelegate?: boolean;
    delegateTo?: string;
  }>;
  intelligence: {
    emailHighlights: string[];
    documentActivity: string[];
    patterns: string[];
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
// Provider Config
// ============================================================================

const PROVIDERS = {
  gmail: { icon: Mail, label: 'Gmail', color: 'text-rose-400', bg: 'bg-rose-500/15', border: 'border-rose-500/20' },
  calendar: { icon: Calendar, label: 'Calendar', color: 'text-sky-400', bg: 'bg-sky-500/15', border: 'border-sky-500/20' },
  drive: { icon: FileText, label: 'Drive', color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/20' },
};

// ============================================================================
// Main Component
// ============================================================================

export function DailyBriefingWidget() {
  const { isLoaded, user } = useUser();
  const router = useRouter();
  const { providers, isSyncing, isInitialized, displayStrings } = useSyncManager();

  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    urgent: true,
    schedule: false,
    actions: false,
    intelligence: false,
  });

  const connectedProviders = (['gmail', 'calendar', 'drive'] as ProviderKey[])
    .filter((p) => providers[p].status === 'connected');
  
  const hasConnections = connectedProviders.length > 0;

  // ============================================================================
  // Fetch Briefing
  // ============================================================================

  const fetchBriefing = useCallback(async () => {
    if (!user?.id || !hasConnections) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const today = getCurrentUTCDate();
      const response = await fetch(`/api/ai/briefing/${today}`);
      
      if (response.ok) {
        const data = await response.json();
        // API returns: { found, briefingId, briefingDate, generatedAt, content }
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
        // No briefing for today yet
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
        // Refetch to get the new briefing
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

  // Listen for connection updates
  useEffect(() => {
    const handleConnectionsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail?.phase === 'complete' && customEvent.detail?.briefingRegenerated) {
        // Refetch briefing when it's been regenerated
        fetchBriefing();
      }
    };

    window.addEventListener('eos:connections-updated', handleConnectionsUpdated);
    return () => {
      window.removeEventListener('eos:connections-updated', handleConnectionsUpdated);
    };
  }, [fetchBriefing]);

  // ============================================================================
  // Section Toggle
  // ============================================================================

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // ============================================================================
  // Render States
  // ============================================================================

  if (!isLoaded || !isInitialized) {
    return <BriefingLoadingSkeleton />;
  }

  if (!hasConnections) {
    return <NoConnectionsState providers={providers} onConnect={() => router.push('/settings')} />;
  }

  if (isLoading) {
    return <BriefingLoadingSkeleton />;
  }

  if (error) {
    return (
      <Card className="p-6 h-full flex flex-col">
        <BriefingHeader providers={providers} lastSyncDisplay={displayStrings.global} />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Error Loading Briefing</h3>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <Button onClick={fetchBriefing} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (!briefing) {
    return (
      <Card className="p-6 h-full flex flex-col">
        <BriefingHeader providers={providers} lastSyncDisplay={displayStrings.global} />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <div className="relative mb-5">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 to-orange-500/10 rounded-2xl blur-xl" />
            <div className="relative h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center ring-1 ring-amber-500/20">
              <Sparkles className="h-8 w-8 text-amber-400" />
            </div>
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No Briefing Yet</h3>
          <p className="text-sm text-muted-foreground max-w-xs mb-6">
            Generate your AI-powered daily briefing to get strategic insights.
          </p>
          <Button 
            onClick={handleGenerateBriefing} 
            disabled={isGenerating || isSyncing}
            className="bg-amber-500 hover:bg-amber-600 text-white"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Briefing
              </>
            )}
          </Button>
        </div>
      </Card>
    );
  }

  // ============================================================================
  // Main Briefing Display
  // ============================================================================

  const content = briefing.content;

  return (
    <Card className="p-6 h-full flex flex-col">
      <BriefingHeader 
        providers={providers} 
        lastSyncDisplay={displayStrings.global}
      />

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto -mx-2 px-2 space-y-4 eos-scrollbar-thin">
        {/* Executive Summary */}
        <div className="bg-gradient-to-br from-amber-500/5 to-orange-500/5 rounded-xl p-4 border border-amber-500/10">
          <p className="text-sm text-foreground leading-relaxed">
            {content.executiveSummary}
          </p>
        </div>

        {/* Top Priority */}
        {content.topPriority && (
          <div className="bg-secondary/30 rounded-xl p-4 border border-border/50">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-4 w-4 text-amber-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                Top Priority
              </span>
            </div>
            <h4 className="font-medium text-foreground mb-1">{content.topPriority.item}</h4>
            <p className="text-xs text-muted-foreground mb-2">{content.topPriority.reason}</p>
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <Zap className="h-3 w-3" />
              <span>{content.topPriority.suggestedAction}</span>
            </div>
          </div>
        )}

        {/* Urgent Attention */}
        {content.urgentAttention && content.urgentAttention.length > 0 && (
          <CollapsibleSection
            title="Urgent Attention"
            icon={<AlertTriangle className="h-4 w-4 text-red-400" />}
            count={content.urgentAttention.length}
            isExpanded={expandedSections.urgent}
            onToggle={() => toggleSection('urgent')}
            accentColor="red"
          >
            <div className="space-y-2">
              {content.urgentAttention.map((item, idx) => (
                <div key={idx} className="flex items-start gap-3 p-2 rounded-lg bg-background/50">
                  <span className={cn(
                    'text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0',
                    item.type === 'EMAIL' && 'bg-rose-500/15 text-rose-400',
                    item.type === 'MEETING' && 'bg-sky-500/15 text-sky-400',
                    item.type === 'DOCUMENT' && 'bg-emerald-500/15 text-emerald-400',
                    item.type === 'CONFLICT' && 'bg-red-500/15 text-red-400'
                  )}>
                    {item.type}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">{item.item}</p>
                    <p className="text-[11px] text-muted-foreground">{item.action}</p>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Schedule Insight */}
        {content.scheduleInsight && (
          <CollapsibleSection
            title="Schedule Overview"
            icon={<Clock className="h-4 w-4 text-sky-400" />}
            isExpanded={expandedSections.schedule}
            onToggle={() => toggleSection('schedule')}
            accentColor="sky"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-background/50">
                <span className="text-2xl font-bold text-foreground">
                  {content.scheduleInsight.meetingCount}
                </span>
                <p className="text-xs text-muted-foreground">Meetings today</p>
              </div>
              <div className="p-3 rounded-lg bg-background/50">
                <span className="text-2xl font-bold text-foreground">
                  {content.scheduleInsight.totalMeetingHours?.toFixed(1) || 0}h
                </span>
                <p className="text-xs text-muted-foreground">Meeting time</p>
              </div>
            </div>
            {content.scheduleInsight.conflicts?.length > 0 && (
              <div className="mt-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400 font-medium">
                  ⚠️ {content.scheduleInsight.conflicts.length} conflict(s) detected
                </p>
              </div>
            )}
            {content.scheduleInsight.freeBlocks?.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground mb-1">Free blocks:</p>
                <div className="flex flex-wrap gap-1">
                  {content.scheduleInsight.freeBlocks.slice(0, 3).map((block, idx) => (
                    <span key={idx} className="text-[10px] px-2 py-1 rounded bg-emerald-500/10 text-emerald-400">
                      {block}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CollapsibleSection>
        )}

        {/* Action Items */}
        {content.actionItems && content.actionItems.length > 0 && (
          <CollapsibleSection
            title="Action Items"
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
            count={content.actionItems.length}
            isExpanded={expandedSections.actions}
            onToggle={() => toggleSection('actions')}
            accentColor="emerald"
          >
            <div className="space-y-2">
              {content.actionItems.map((item, idx) => (
                <div key={idx} className="flex items-start gap-3 p-2 rounded-lg bg-background/50">
                  <div className={cn(
                    'w-2 h-2 rounded-full mt-1.5 shrink-0',
                    item.priority === 'HIGH' && 'bg-red-400',
                    item.priority === 'MEDIUM' && 'bg-amber-400',
                    item.priority === 'LOW' && 'bg-emerald-400'
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground">{item.task}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Source: {item.source}
                      {item.canDelegate && item.delegateTo && ` • Can delegate to: ${item.delegateTo}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Intelligence */}
        {content.intelligence && (
          <CollapsibleSection
            title="Intelligence"
            icon={<Lightbulb className="h-4 w-4 text-amber-400" />}
            isExpanded={expandedSections.intelligence}
            onToggle={() => toggleSection('intelligence')}
            accentColor="amber"
          >
            {content.intelligence.emailHighlights?.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Email Highlights</p>
                <ul className="text-xs text-foreground space-y-1">
                  {content.intelligence.emailHighlights.slice(0, 3).map((highlight, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-rose-400">•</span>
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {content.intelligence.patterns?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Patterns Noticed</p>
                <ul className="text-xs text-foreground space-y-1">
                  {content.intelligence.patterns.slice(0, 2).map((pattern, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-amber-400">•</span>
                      <span>{pattern}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CollapsibleSection>
        )}

        {/* Closing Note */}
        {content.closingNote && (
          <div className="p-4 rounded-xl bg-gradient-to-br from-teal-500/5 to-emerald-500/5 border border-teal-500/10">
            <p className="text-xs text-teal-400 italic">&ldquo;{content.closingNote}&rdquo;</p>
          </div>
        )}
      </div>
    </Card>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

function BriefingHeader({ 
  providers, 
  lastSyncDisplay,
}: { 
  providers: Record<ProviderKey, { status: string; lastSyncAt: string | null; isSyncing: boolean }>;
  lastSyncDisplay?: string;
}) {
  return (
    <div className="flex items-start justify-between mb-4">
        <div className="widget-header">
          <div className="widget-icon bg-gradient-to-br from-amber-500/20 to-orange-500/10 ring-1 ring-amber-500/20">
            <Sparkles className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h3 className="widget-title">Daily Briefing</h3>
          <p className="widget-subtitle">
            {lastSyncDisplay && lastSyncDisplay !== 'Not connected'
              ? lastSyncDisplay
              : 'AI-powered insights'
            }
          </p>
        </div>
      </div>
      <SourcePills providers={providers} />
    </div>
  );
}

function SourcePills({ 
  providers, 
}: { 
  providers: Record<ProviderKey, { status: string; lastSyncAt: string | null; isSyncing: boolean }>; 
}) {
  const gmailConnected = providers.gmail?.status === 'connected';
  const calendarConnected = providers.calendar?.status === 'connected';
  const driveConnected = providers.drive?.status === 'connected';
  
  return (
    <div className="flex items-center gap-1">
      <div className={cn(
        'flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all',
        gmailConnected ? 'bg-rose-500/10 border border-rose-500/20' : 'bg-secondary/50 border border-border'
      )}>
        <Mail className={cn('h-3 w-3', gmailConnected ? 'text-rose-400' : 'text-muted-foreground/50')} />
        {gmailConnected ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" /> : <AlertTriangle className="h-2.5 w-2.5 text-amber-400" />}
      </div>
      <div className={cn(
        'flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all',
        calendarConnected ? 'bg-sky-500/10 border border-sky-500/20' : 'bg-secondary/50 border border-border'
      )}>
        <Calendar className={cn('h-3 w-3', calendarConnected ? 'text-sky-400' : 'text-muted-foreground/50')} />
        {calendarConnected ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" /> : <AlertTriangle className="h-2.5 w-2.5 text-amber-400" />}
      </div>
      <div className={cn(
        'flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all',
        driveConnected ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-secondary/50 border border-border'
      )}>
        <FileText className={cn('h-3 w-3', driveConnected ? 'text-emerald-400' : 'text-muted-foreground/50')} />
        {driveConnected ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" /> : <AlertTriangle className="h-2.5 w-2.5 text-amber-400" />}
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  icon,
  count,
  isExpanded,
  onToggle,
  accentColor,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  isExpanded: boolean;
  onToggle: () => void;
  accentColor: 'red' | 'sky' | 'emerald' | 'amber';
  children: React.ReactNode;
}) {
  const colorClasses = {
    red: 'border-red-500/20 hover:border-red-500/30',
    sky: 'border-sky-500/20 hover:border-sky-500/30',
    emerald: 'border-emerald-500/20 hover:border-emerald-500/30',
    amber: 'border-amber-500/20 hover:border-amber-500/30',
  };

  return (
    <div className={cn('rounded-xl border bg-secondary/20 overflow-hidden transition-colors', colorClasses[accentColor])}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-foreground">{title}</span>
          {count !== undefined && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
              {count}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {isExpanded && (
        <div className="px-3 pb-3 pt-1">
          {children}
        </div>
      )}
    </div>
  );
}

function BriefingLoadingSkeleton() {
  return (
    <Card className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
      <div className="space-y-3 flex-1">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    </Card>
  );
}

function NoConnectionsState({ 
  providers, 
  onConnect,
}: { 
  providers: Record<ProviderKey, { status: string; lastSyncAt: string | null; isSyncing: boolean }>;
  onConnect: () => void;
}) {
  return (
    <Card className="p-6 h-full flex flex-col">
      <BriefingHeader providers={providers} />
      
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
        <Button onClick={onConnect} className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-6">
          Connect Accounts
        </Button>
      </div>
    </Card>
  );
}
