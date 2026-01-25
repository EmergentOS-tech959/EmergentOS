'use client';

/**
 * EmergentOS - Calendar Insights Modal
 * 
 * Displays AI-generated calendar analysis including:
 * - Executive summary
 * - Urgent actions
 * - Conflict resolutions
 * - Delegation opportunities
 * - Focus time protection
 * - Weekly insights
 */

import { useMemo, useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { 
  Sparkles, 
  AlertTriangle, 
  Clock, 
  Calendar,
  Zap,
  CheckCircle,
  ArrowRight,
  Users,
  Target,
  TrendingUp,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types - Matches specification Section 9.3
// ============================================================================

interface UrgentAction {
  priority: number;
  action: string;
  reason: string;
  timeframe: string;
}

interface ConflictResolution {
  conflictingEvents: string[];
  recommendation: string;
  suggestedAction: string;
}

interface DelegationOpportunity {
  meeting: string;
  reason: string;
  suggestedDelegate: string;
}

interface FocusTimeProtection {
  availableHours: number;
  recommendation: string;
  suggestedBlocks: string[];
}

interface WeeklyInsights {
  meetingLoad: 'LIGHT' | 'MODERATE' | 'HEAVY' | 'OVERLOADED';
  balanceScore: number;
  topConcern: string;
}

interface Metrics {
  meetingHoursTotal: number;
  focusHoursAvailable: number;
  conflictCount: number;
  backToBackCount: number;
}

interface CalendarInsightContent {
  executiveSummary: string;
  urgentActions: UrgentAction[];
  conflictResolutions: ConflictResolution[];
  delegationOpportunities: DelegationOpportunity[];
  focusTimeProtection: FocusTimeProtection;
  weeklyInsights: WeeklyInsights;
  metrics: Metrics;
}

export interface CalendarInsight {
  id: string;
  content: CalendarInsightContent;
  conflictsCount: number;
  focusTimeHours: number;
  meetingHours: number;
  generatedAt: string;
}

interface SuggestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  insight: CalendarInsight | null;
}

// ============================================================================
// Main Component
// ============================================================================

export function SuggestionsModal({ isOpen, onClose, insight }: SuggestionsModalProps) {
  // REAL-TIME TIMESTAMP: Tick state forces re-render every minute for live updates
  const [timeTick, setTimeTick] = useState(0);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  useEffect(() => {
    if (isOpen) {
      tickIntervalRef.current = setInterval(() => {
        setTimeTick((t) => t + 1);
      }, 60000);
    }
    return () => {
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    };
  }, [isOpen]);

  const generatedTimeDisplay = useMemo(() => {
    void timeTick;
    if (!insight?.generatedAt) return null;
    const d = new Date(insight.generatedAt);
    const now = new Date();
    const diffMins = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return d.toLocaleDateString();
  }, [insight?.generatedAt, timeTick]);

  const content = insight?.content;
  const metrics = content?.metrics;
  const weeklyInsights = content?.weeklyInsights;

  // Calculate balance score for display
  const balanceScore = weeklyInsights?.balanceScore ?? 75;
  const scoreColor = balanceScore >= 80 ? 'text-emerald-500' : balanceScore >= 60 ? 'text-amber-500' : 'text-red-500';
  const meetingLoadColor = {
    'LIGHT': 'text-emerald-500 bg-emerald-500/10',
    'MODERATE': 'text-sky-500 bg-sky-500/10',
    'HEAVY': 'text-amber-500 bg-amber-500/10',
    'OVERLOADED': 'text-red-500 bg-red-500/10',
  }[weeklyInsights?.meetingLoad || 'MODERATE'];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[1000px] w-[92vw] h-[85vh] max-h-[750px] p-0 flex flex-col bg-background border-border/50 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-6 py-5 border-b border-border/50 bg-secondary/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold text-foreground">
                  Calendar Analysis
                </DialogTitle>
                <div className="flex items-center gap-3 mt-0.5">
                  {(insight?.conflictsCount ?? 0) > 0 && (
                    <span className="text-xs text-amber-500 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {insight?.conflictsCount} conflict{(insight?.conflictsCount ?? 0) !== 1 ? 's' : ''}
                    </span>
                  )}
                  {generatedTimeDisplay && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {generatedTimeDisplay}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 eos-scrollbar">
          {!content ? (
            <NoDataState />
          ) : (
            <>
              {/* Metrics Overview */}
              <MetricsOverview 
                metrics={metrics} 
                weeklyInsights={weeklyInsights}
                balanceScore={balanceScore}
                scoreColor={scoreColor}
                meetingLoadColor={meetingLoadColor}
              />

              {/* Executive Summary */}
              {content.executiveSummary && (
                <div className="p-5 bg-secondary/40 rounded-xl border border-border/30">
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-sky-500" />
                    Executive Summary
                  </h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {content.executiveSummary}
                  </p>
                </div>
              )}

              {/* Urgent Actions */}
              {content.urgentActions && content.urgentActions.length > 0 && (
                <UrgentActionsSection actions={content.urgentActions} />
              )}

              {/* Conflict Resolutions */}
              {content.conflictResolutions && content.conflictResolutions.length > 0 && (
                <ConflictResolutionsSection conflicts={content.conflictResolutions} />
              )}

              {/* Delegation Opportunities */}
              {content.delegationOpportunities && content.delegationOpportunities.length > 0 && (
                <DelegationSection opportunities={content.delegationOpportunities} />
              )}

              {/* Focus Time Protection */}
              {content.focusTimeProtection && (
                <FocusTimeSection protection={content.focusTimeProtection} />
              )}

              {/* Top Concern */}
              {weeklyInsights?.topConcern && (
                <div className="p-4 rounded-xl bg-gradient-to-br from-amber-500/5 to-orange-500/5 border border-amber-500/10">
                  <p className="text-xs font-medium text-amber-400 mb-1">Top Concern This Week</p>
                  <p className="text-sm text-foreground">{weeklyInsights.topConcern}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border/50 px-6 py-4 flex items-center justify-between bg-secondary/20">
          <p className="text-[10px] text-muted-foreground/60">
            AI-powered analysis • Updates when calendar syncs
          </p>
          <Button 
            onClick={onClose}
            variant="secondary"
            size="sm"
            className="font-medium px-4"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

function NoDataState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-12">
      <div className="w-14 h-14 rounded-xl bg-sky-500/10 flex items-center justify-center mb-4">
        <Calendar className="h-7 w-7 text-sky-500" />
      </div>
      <p className="text-base font-semibold text-foreground mb-1">No Analysis Available</p>
      <p className="text-xs text-muted-foreground max-w-xs">
        Sync your calendar to generate AI-powered insights about your schedule.
      </p>
    </div>
  );
}

function MetricsOverview({ 
  metrics, 
  weeklyInsights,
  balanceScore,
  scoreColor,
  meetingLoadColor,
}: { 
  metrics?: Metrics;
  weeklyInsights?: WeeklyInsights;
  balanceScore: number;
  scoreColor: string;
  meetingLoadColor: string;
}) {
  if (!metrics) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {/* Balance Score */}
      <div className={cn(
        'p-4 rounded-xl border',
        balanceScore >= 80 
          ? 'bg-emerald-500/5 border-emerald-500/20' 
          : balanceScore >= 60 
          ? 'bg-amber-500/5 border-amber-500/20'
          : 'bg-red-500/5 border-red-500/20'
      )}>
        <p className="text-xs text-muted-foreground mb-1">Balance Score</p>
        <p className={cn('text-2xl font-bold', scoreColor)}>
          {balanceScore}<span className="text-sm text-muted-foreground/50">/100</span>
        </p>
      </div>

      {/* Meeting Load */}
      <div className="p-4 rounded-xl border bg-secondary/30 border-border/30">
        <p className="text-xs text-muted-foreground mb-1">Meeting Load</p>
        <span className={cn('text-sm font-semibold px-2 py-1 rounded-md', meetingLoadColor)}>
          {weeklyInsights?.meetingLoad || 'N/A'}
        </span>
      </div>

      {/* Meeting Hours */}
      <div className="p-4 rounded-xl border bg-secondary/30 border-border/30">
        <p className="text-xs text-muted-foreground mb-1">Meeting Hours</p>
        <p className="text-2xl font-bold text-foreground">
          {(metrics.meetingHoursTotal || 0).toFixed(1)}<span className="text-sm text-muted-foreground/50">h</span>
        </p>
      </div>

      {/* Focus Time */}
      <div className="p-4 rounded-xl border bg-secondary/30 border-border/30">
        <p className="text-xs text-muted-foreground mb-1">Focus Time</p>
        <p className="text-2xl font-bold text-emerald-500">
          {(metrics.focusHoursAvailable || 0).toFixed(1)}<span className="text-sm text-muted-foreground/50">h</span>
        </p>
      </div>
    </div>
  );
}

function UrgentActionsSection({ actions }: { actions: UrgentAction[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Zap className="h-4 w-4 text-red-500" />
        Urgent Actions
      </h4>
      <div className="space-y-2">
        {actions.slice(0, 5).map((action, i) => (
          <div key={i} className="p-4 bg-red-500/5 border border-red-500/15 rounded-xl">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-md bg-red-500/15 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-bold text-red-500">{action.priority}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-foreground">{action.action}</p>
                <p className="text-xs text-muted-foreground mt-1">{action.reason}</p>
                <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-500">
                  <Clock className="h-3 w-3" />
                  <span>{action.timeframe}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConflictResolutionsSection({ conflicts }: { conflicts: ConflictResolution[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        Conflict Resolutions
      </h4>
      <div className="space-y-2.5">
        {conflicts.map((conflict, i) => (
          <div key={i} className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {conflict.conflictingEvents.map((event, j) => (
                <span key={j} className="text-xs px-2 py-1 rounded-md bg-secondary text-foreground">
                  {event}
                </span>
              ))}
            </div>
            <p className="text-sm text-muted-foreground mb-2">{conflict.recommendation}</p>
            <div className="flex items-center gap-2">
              <span className={cn(
                'text-[10px] px-2 py-1 rounded-full uppercase font-semibold',
                conflict.suggestedAction === 'DECLINE' ? 'bg-red-500/15 text-red-500' :
                conflict.suggestedAction === 'RESCHEDULE' ? 'bg-amber-500/15 text-amber-500' :
                conflict.suggestedAction === 'DELEGATE' ? 'bg-sky-500/15 text-sky-500' :
                'bg-emerald-500/15 text-emerald-500'
              )}>
                {conflict.suggestedAction}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DelegationSection({ opportunities }: { opportunities: DelegationOpportunity[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-sky-500" />
        Delegation Opportunities
      </h4>
      <div className="space-y-2">
        {opportunities.map((opp, i) => (
          <div key={i} className="p-4 bg-sky-500/5 border border-sky-500/15 rounded-xl">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-md bg-sky-500/15 flex items-center justify-center shrink-0 mt-0.5">
                <Users className="h-3.5 w-3.5 text-sky-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-foreground">{opp.meeting}</p>
                <p className="text-xs text-muted-foreground mt-1">{opp.reason}</p>
                <div className="flex items-center gap-1.5 mt-2 text-xs text-sky-500">
                  <ArrowRight className="h-3 w-3" />
                  <span>Delegate to: {opp.suggestedDelegate}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FocusTimeSection({ protection }: { protection: FocusTimeProtection }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Shield className="h-4 w-4 text-emerald-500" />
        Focus Time Protection
      </h4>
      <div className="p-4 bg-emerald-500/5 border border-emerald-500/15 rounded-xl">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-muted-foreground">Available Focus Hours</span>
          <span className="text-lg font-bold text-emerald-500">
            {protection.availableHours.toFixed(1)}h
          </span>
        </div>
        <p className="text-sm text-muted-foreground mb-3">{protection.recommendation}</p>
        {protection.suggestedBlocks && protection.suggestedBlocks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {protection.suggestedBlocks.map((block, i) => (
              <span key={i} className="text-xs px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-500">
                {block}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
