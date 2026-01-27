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

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { 
  X,
  AlertTriangle, 
  Clock, 
  Calendar,
  Zap,
  CheckCircle,
  ArrowRight,
  Users,
  Target,
  TrendingUp,
  TrendingDown,
  Shield,
  Lightbulb,
  Brain,
  Activity,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { formatTimeBlock } from '@/lib/time';

// ============================================================================
// Types - Enhanced for Structured Output (Section 9.3)
// ============================================================================

interface UrgentAction {
  priority: number;
  action: string;
  reason: string;
  timeframe: string;
  relatedEvents?: string[];
}

interface ConflictResolution {
  conflictingEvents: string[];
  overlapMinutes?: number;
  recommendation: string;
  suggestedAction: 'RESCHEDULE' | 'DELEGATE' | 'DECLINE' | 'SHORTEN';
  keepEvent?: string;
  moveEvent?: string;
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface DelegationOpportunity {
  meeting: string;
  reason: string;
  suggestedDelegate: string;
}

interface FocusTimeProtection {
  availableHours: number;
  recommendation: string;
  suggestedBlocks?: string[];
  riskAreas?: string[];
}

interface WeeklyInsights {
  meetingLoad: 'LIGHT' | 'MODERATE' | 'HEAVY' | 'OVERLOADED';
  balanceScore: number;
  topConcern: string;
  positivePatterns?: string[];
  alignmentScore?: number;
}

interface PersonalizedInsight {
  category: 'GOAL_ALIGNMENT' | 'BLOCKER_RISK' | 'FLOW_PROTECTION' | 'DECISION_SUPPORT';
  insight: string;
  recommendation: string;
}

interface Metrics {
  meetingHoursTotal: number;
  focusHoursAvailable: number;
  conflictCount: number;
  backToBackCount: number;
  averageMeetingLength?: number;
  busiestDay?: string;
  lightestDay?: string;
}

interface CalendarInsightContent {
  executiveSummary: string;
  healthScore?: number;
  verdict?: 'OPTIMAL' | 'GOOD' | 'CONCERNING' | 'CRITICAL';
  urgentActions: UrgentAction[];
  conflictResolutions: ConflictResolution[];
  delegationOpportunities?: DelegationOpportunity[];
  focusTimeProtection: FocusTimeProtection;
  weeklyInsights: WeeklyInsights;
  personalizedInsights?: PersonalizedInsight[] | null;
  metrics: Metrics;
}

export interface CalendarInsight {
  id: string;
  content: CalendarInsightContent;
  conflictsCount: number;
  focusTimeHours: number;
  meetingHours: number;
  healthScore?: number;
  verdict?: string;
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
  const content = insight?.content;
  const metrics = content?.metrics;
  const weeklyInsights = content?.weeklyInsights;
  const personalizedInsights = content?.personalizedInsights;

  // Use healthScore from content if available, otherwise fall back to balanceScore
  const healthScore = content?.healthScore ?? weeklyInsights?.balanceScore ?? 75;
  const verdict = content?.verdict ?? null;
  
  // SIMPLIFIED COLOR SCHEME: Only 3 semantic colors
  // - Emerald: Good/Positive (80+)
  // - Neutral: Moderate/Normal (40-79)
  // - Red: Critical/Bad (<40)
  const scoreColor = healthScore >= 80 ? 'text-emerald-500' : healthScore < 40 ? 'text-red-500' : 'text-foreground';
  
  const meetingLoadColor = {
    'LIGHT': 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
    'MODERATE': 'text-muted-foreground bg-secondary',
    'HEAVY': 'text-foreground bg-secondary',
    'OVERLOADED': 'text-red-500 bg-red-500/10',
  }[weeklyInsights?.meetingLoad || 'MODERATE'];
  
  const verdictConfig = {
    'OPTIMAL': { color: 'text-emerald-500', bg: 'bg-emerald-500/10', icon: TrendingUp },
    'GOOD': { color: 'text-foreground', bg: 'bg-secondary', icon: TrendingUp },
    'CONCERNING': { color: 'text-foreground', bg: 'bg-secondary', icon: AlertTriangle },
    'CRITICAL': { color: 'text-red-500', bg: 'bg-red-500/10', icon: TrendingDown },
  };
  const verdictStyle = verdict ? verdictConfig[verdict as keyof typeof verdictConfig] : null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        showCloseButton={false}
        className="max-w-[1100px] w-[92vw] h-[85vh] max-h-[800px] p-0 flex flex-col bg-[#0c1117] border-2 border-violet-500/30 shadow-[0_0_50px_rgba(139,92,246,0.1)] rounded-2xl overflow-hidden gap-0"
      >
        {/* Header */}
        <div className="shrink-0 px-6 py-5 border-b border-violet-500/20 bg-gradient-to-r from-violet-500/10 via-transparent to-transparent sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500/25 to-purple-500/15 border border-violet-500/30 text-violet-500 shadow-lg shadow-violet-500/10">
                <Brain className="w-5 h-5" />
              </div>
              <div className="flex items-center gap-2.5">
                <DialogTitle className="text-xl font-semibold tracking-tight text-foreground">
                  Calendar Analysis
                </DialogTitle>
                {verdictStyle && (
                  <span className={cn(
                    'text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider',
                    verdictStyle.bg,
                    verdictStyle.color
                  )}>
                    {verdict}
                  </span>
                )}
              </div>
            </div>
            {/* Close Button */}
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
        <div className="flex-1 p-6 space-y-6 overflow-y-auto bg-secondary/5 scroll-smooth eos-scrollbar">
          {!content ? (
            <NoDataState />
          ) : (
            <>
              {/* Metrics Overview */}
              <div className="bg-card/80 rounded-2xl border border-border/50 shadow-lg p-1.5">
                <MetricsOverview 
                  metrics={metrics} 
                  weeklyInsights={weeklyInsights}
                  healthScore={healthScore}
                  scoreColor={scoreColor}
                  meetingLoadColor={meetingLoadColor}
                  conflictsCount={insight?.conflictsCount ?? 0}
                />
                {/* Analysis Period Info */}
                <div className="px-4 py-2.5 border-t border-border/30 bg-secondary/30 rounded-b-xl">
                  <p className="text-[11px] text-muted-foreground text-center">
                    <span className="text-violet-400/80 font-medium">Analysis period:</span>{' '}
                    Next 7 days • Focus on this week&apos;s schedule
                  </p>
                </div>
              </div>

              {/* Executive Summary */}
              {content.executiveSummary && (
                <div className="p-6 bg-card/80 rounded-2xl border border-border/50 shadow-lg">
                  <h4 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Executive Summary
                  </h4>
                  <p className="text-base leading-relaxed text-muted-foreground">
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

              {/* Personalized Insights (if onboarding completed) */}
              {personalizedInsights && personalizedInsights.length > 0 && (
                <PersonalizedInsightsSection insights={personalizedInsights} />
              )}

              <div className="grid gap-6 md:grid-cols-2">
              {/* Top Concern */}
              {weeklyInsights?.topConcern && (
                  <div className="p-5 bg-card rounded-xl border shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                      <h4 className="text-sm font-semibold text-foreground">Top Concern</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">{weeklyInsights.topConcern}</p>
                  </div>
                )}

                {/* Positive Patterns */}
                {weeklyInsights?.positivePatterns && weeklyInsights.positivePatterns.length > 0 && (
                  <div className="p-5 bg-card rounded-xl border shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                      <h4 className="text-sm font-semibold text-foreground">Positive Patterns</h4>
                    </div>
                    <ul className="space-y-2">
                      {weeklyInsights.positivePatterns.map((pattern, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                          <span className="w-1 h-1 mt-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <span>{pattern}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                </div>

              {/* Extended Metrics */}
              {metrics && (metrics.busiestDay || metrics.lightestDay || metrics.averageMeetingLength) && (
                <ExtendedMetricsSection metrics={metrics} />
              )}
            </>
          )}
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
      <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-4">
        <Calendar className="h-7 w-7 text-muted-foreground" />
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
  healthScore,
  scoreColor,
  meetingLoadColor,
  conflictsCount,
}: { 
  metrics?: Metrics;
  weeklyInsights?: WeeklyInsights;
  healthScore: number;
  scoreColor: string;
  meetingLoadColor: string;
  conflictsCount: number;
}) {
  if (!metrics) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {/* Health Score */}
      <div className={cn(
        'flex flex-col justify-between p-4 rounded-xl border bg-card/50 transition-colors',
        healthScore >= 80 
          ? 'border-emerald-500/20 bg-emerald-500/5' 
          : healthScore >= 60 
          ? 'border-amber-500/20 bg-amber-500/5'
          : 'border-red-500/20 bg-red-500/5'
      )}>
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Health Score</p>
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
                <p><span className="text-red-400">−15</span> per conflict</p>
                <p><span className="text-amber-400">−</span> back-to-back meetings</p>
                <p><span className="text-emerald-400">+</span> available focus time</p>
              </div>
              <div className="mt-2 pt-2 border-t border-border/30 text-[10px] text-muted-foreground/70">
                80+ Optimal • 60-79 Good • 40-59 Caution • &lt;40 Critical
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
        <p className={cn('text-3xl font-bold tracking-tight mt-1', scoreColor)}>
          {healthScore}<span className="text-sm font-medium text-muted-foreground/60 ml-1">/100</span>
        </p>
      </div>

      {/* Conflicts - Prominent when > 0 */}
      <div className={cn(
        'flex flex-col justify-between p-4 rounded-xl border transition-colors',
        conflictsCount > 0 
          ? 'border-red-500/30 bg-red-500/10 ring-1 ring-red-500/20' 
          : 'border-emerald-500/20 bg-emerald-500/5'
      )}>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Conflicts</p>
        <div className="flex items-center gap-2 mt-1">
          {conflictsCount > 0 && <AlertTriangle className="w-5 h-5 text-red-500" />}
          <p className={cn(
            'text-3xl font-bold tracking-tight',
            conflictsCount > 0 ? 'text-red-500' : 'text-emerald-500'
          )}>
            {conflictsCount}
          </p>
        </div>
      </div>

      {/* Meeting Load */}
      <div className="flex flex-col justify-between p-4 rounded-xl border bg-card shadow-sm">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Meeting Load</p>
        <div className="mt-2">
          <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider', meetingLoadColor)}>
          {weeklyInsights?.meetingLoad || 'N/A'}
        </span>
        </div>
      </div>

      {/* Meeting Hours */}
      <div className="flex flex-col justify-between p-4 rounded-xl border bg-card shadow-sm">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Meeting Hours</p>
        <p className="text-2xl font-bold tracking-tight text-foreground mt-1">
          {(metrics.meetingHoursTotal || 0).toFixed(1)}<span className="text-sm font-medium text-muted-foreground ml-1">h</span>
        </p>
      </div>

      {/* Focus Time */}
      <div className="flex flex-col justify-between p-4 rounded-xl border bg-card shadow-sm">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Focus Time</p>
        <p className="text-2xl font-bold tracking-tight text-emerald-500 mt-1">
          {(metrics.focusHoursAvailable || 0).toFixed(1)}<span className="text-sm font-medium text-muted-foreground ml-1">h</span>
        </p>
      </div>
    </div>
  );
}

function UrgentActionsSection({ actions }: { actions: UrgentAction[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Zap className="w-4 h-4 text-red-500" />
        Urgent Actions
      </h4>
      <div className="space-y-3">
        {actions.slice(0, 5).map((action, i) => (
          <div key={i} className="group relative p-4 bg-card rounded-xl border shadow-sm transition-all hover:shadow-md hover:border-border">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 rounded-l-xl" />
            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-500/10 text-red-500 font-bold text-sm shrink-0">
                {action.priority}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-foreground">{action.action}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{action.reason}</p>
                <div className="flex items-center gap-2 mt-3">
                  <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary text-muted-foreground text-[10px] font-medium">
                    <Clock className="w-3 h-3" />
                  <span>{action.timeframe}</span>
                  </div>
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
      <h4 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-500/10">
          <AlertTriangle className="w-4 h-4 text-red-500" />
        </div>
        <span>Scheduling Conflicts</span>
        <span className="ml-2 px-2 py-0.5 text-xs font-bold rounded-full bg-red-500/10 text-red-500">
          {conflicts.length}
        </span>
      </h4>
      <div className="space-y-4">
        {conflicts.map((conflict, i) => (
          <div key={i} className="p-5 rounded-2xl bg-card border border-red-500/20">
            {/* Conflict Header */}
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-border/50">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-red-500 uppercase tracking-wider">Double Booking</span>
                {conflict.overlapMinutes && conflict.overlapMinutes > 0 && (
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-secondary text-muted-foreground">
                    {conflict.overlapMinutes} min overlap
                  </span>
                )}
              </div>
            </div>
            
            {/* Conflicting Events with Keep/Move indicators */}
            <div className="flex flex-col sm:flex-row gap-2 mb-4">
              {conflict.conflictingEvents.map((event, j) => {
                const isKeep = conflict.keepEvent === event;
                const isMove = conflict.moveEvent === event;
                return (
                  <div key={j} className={cn(
                    'flex-1 px-3 py-2 rounded-lg border',
                    isKeep ? 'bg-emerald-500/5 border-emerald-500/20' :
                    isMove ? 'bg-secondary border-border' :
                    'bg-card border-border'
                  )}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{event}</span>
                      {isKeep && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">
                          KEEP
                        </span>
                      )}
                      {isMove && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-semibold">
                          MOVE
                </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            
            {/* Recommendation */}
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{conflict.recommendation}</p>
            
            {/* Action Badge - Simplified: only decline is red, rest are neutral */}
            <div className="flex items-center gap-3">
              <span className={cn(
                'text-xs px-3 py-1.5 rounded-lg uppercase font-bold tracking-wide',
                conflict.suggestedAction === 'DECLINE' ? 'bg-red-500/10 text-red-500' :
                'bg-secondary text-foreground'
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
        <Users className="w-4 h-4 text-muted-foreground" />
        Delegation Opportunities
      </h4>
      <div className="space-y-3">
        {opportunities.map((opp, i) => (
          <div key={i} className="p-4 bg-card rounded-xl border shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-secondary text-muted-foreground shrink-0">
                <Users className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-foreground">{opp.meeting}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{opp.reason}</p>
                <div className="flex items-center gap-1.5 mt-3 text-xs text-foreground font-medium">
                  <ArrowRight className="w-3.5 h-3.5" />
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
        <Shield className="w-4 h-4 text-emerald-500" />
        Focus Time Protection
      </h4>
      <div className="p-5 bg-card rounded-xl border shadow-sm">
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-border/50">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Available Focus Hours</span>
          <span className="text-2xl font-bold text-emerald-500">
            {protection.availableHours.toFixed(1)}h
          </span>
        </div>
        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{protection.recommendation}</p>
        
        {protection.suggestedBlocks && protection.suggestedBlocks.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-medium text-foreground mb-2">Suggested blocks to protect:</p>
            <div className="flex flex-wrap gap-2">
              {protection.suggestedBlocks.map((block, i) => (
                <span key={i} className="text-xs px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium border border-emerald-500/20">
                  {formatTimeBlock(block)}
                </span>
              ))}
            </div>
          </div>
        )}
        
        {protection.riskAreas && protection.riskAreas.length > 0 && (
          <div>
            <p className="text-xs font-medium text-foreground mb-2">Risk areas (focus threatened):</p>
            <div className="flex flex-wrap gap-2">
              {protection.riskAreas.map((risk, i) => (
                <span key={i} className="text-xs px-2.5 py-1 rounded-md bg-secondary text-muted-foreground font-medium border border-border">
                  {risk}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PersonalizedInsightsSection({ insights }: { insights: PersonalizedInsight[] }) {
  // SIMPLIFIED: All categories use violet (AI theme) with subtle variations
  const categoryConfig = {
    'GOAL_ALIGNMENT': { icon: Target, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/5', border: 'border-violet-500/20', label: 'Goal Alignment' },
    'BLOCKER_RISK': { icon: AlertTriangle, color: 'text-muted-foreground', bg: 'bg-secondary', border: 'border-border', label: 'Blocker Risk' },
    'FLOW_PROTECTION': { icon: Activity, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/5', border: 'border-violet-500/20', label: 'Flow Protection' },
    'DECISION_SUPPORT': { icon: Brain, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/5', border: 'border-violet-500/20', label: 'Decision Support' },
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-violet-500" />
          Personalized Insights
        </h4>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium">
          Based on your profile
        </span>
      </div>
      <div className="space-y-3">
        {insights.map((insight, i) => {
          const config = categoryConfig[insight.category];
          const Icon = config?.icon || Lightbulb;
          return (
            <div key={i} className={cn('p-4 rounded-xl border shadow-sm bg-card', config?.border)}>
              <div className="flex items-start gap-4">
                <div className={cn('flex items-center justify-center w-8 h-8 rounded-lg shrink-0', config?.bg)}>
                  <Icon className={cn('w-4 h-4', config?.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn('text-[10px] font-bold uppercase tracking-wider mb-1', config?.color)}>
                    {config?.label || insight.category}
                  </p>
                  <p className="text-sm text-foreground mb-2 leading-relaxed">{insight.insight}</p>
                  <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/30 p-2 rounded-lg">
                    <span className="font-medium shrink-0">Recommendation:</span>
                    <span>{insight.recommendation}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExtendedMetricsSection({ metrics }: { metrics: Metrics }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {metrics.averageMeetingLength !== undefined && (
        <div className="p-4 rounded-xl border bg-card shadow-sm text-center">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Avg Meeting</p>
          <p className="text-lg font-bold text-foreground">
            {metrics.averageMeetingLength.toFixed(0)}<span className="text-xs text-muted-foreground ml-1">min</span>
          </p>
        </div>
      )}
      {metrics.busiestDay && (
        <div className="p-4 rounded-xl border bg-card shadow-sm text-center">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Busiest Day</p>
          <p className="text-sm font-bold text-foreground">{metrics.busiestDay}</p>
        </div>
      )}
      {metrics.lightestDay && (
        <div className="p-4 rounded-xl border bg-card shadow-sm text-center">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Lightest Day</p>
          <p className="text-sm font-bold text-foreground">{metrics.lightestDay}</p>
        </div>
      )}
    </div>
  );
}
