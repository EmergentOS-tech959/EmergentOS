'use client';

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
  ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CalendarInsight {
  conflicts_count: number;
  suggestions: string;
  generated_at: string;
}

interface SuggestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  insight: CalendarInsight | null;
}

interface ParsedSuggestions {
  score?: number;
  executive_summary?: string;
  conflicts_summary?: string;
  critical_issues?: Array<{ issue: string; urgency: string }>;
  quick_wins?: string[];
  recommendations?: Array<{
    title: string;
    rationale: string;
    action: string;
    priority: string;
  }>;
  suggestions?: Array<{
    title: string;
    rationale?: string;
    action?: string;
    priority?: string;
  }>;
}

export function SuggestionsModal({ isOpen, onClose, insight }: SuggestionsModalProps) {
  // REAL-TIME TIMESTAMP: Tick state forces re-render every minute for live updates
  const [timeTick, setTimeTick] = useState(0);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  useEffect(() => {
    // Only run interval when modal is open
    if (isOpen) {
      tickIntervalRef.current = setInterval(() => {
        setTimeTick((t) => t + 1);
      }, 60000);
    }
    return () => {
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    };
  }, [isOpen]);

  const parsed = useMemo<ParsedSuggestions | null>(() => {
    if (!insight?.suggestions) return null;
    try {
      let raw = insight.suggestions;
      const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) raw = jsonMatch[1];
      const startIdx = raw.indexOf('{');
      const endIdx = raw.lastIndexOf('}');
      if (startIdx >= 0 && endIdx > startIdx) raw = raw.slice(startIdx, endIdx + 1);
      return JSON.parse(raw) as ParsedSuggestions;
    } catch {
      return null;
    }
  }, [insight?.suggestions]);

  const generatedTimeDisplay = useMemo(() => {
    // timeTick dependency ensures this re-computes every minute
    void timeTick;
    if (!insight?.generated_at) return null;
    const d = new Date(insight.generated_at);
    const now = new Date();
    const diffMins = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return d.toLocaleDateString();
  }, [insight?.generated_at, timeTick]);

  const score = parsed?.score ?? 75;
  const scoreColor = score >= 80 ? 'text-green-500' : score >= 60 ? 'text-amber-500' : 'text-red-500';

  const suggestions = parsed?.recommendations || parsed?.suggestions || [];

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
                  Schedule Analysis
                </DialogTitle>
                <div className="flex items-center gap-3 mt-0.5">
                  {(insight?.conflicts_count ?? 0) > 0 && (
                    <span className="text-xs text-amber-500 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {insight?.conflicts_count} conflict{(insight?.conflicts_count ?? 0) !== 1 ? 's' : ''}
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
          {!parsed ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <div className="w-14 h-14 rounded-xl bg-sky-500/10 flex items-center justify-center mb-4">
                <Calendar className="h-7 w-7 text-sky-500" />
              </div>
              <p className="text-base font-semibold text-foreground mb-1">No Analysis Available</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Sync your calendar and run analysis to see AI-powered insights.
              </p>
            </div>
          ) : (
            <>
              {/* Score Card */}
              <div className={cn(
                'p-5 rounded-xl border',
                score >= 80 
                  ? 'bg-emerald-500/5 border-emerald-500/20' 
                  : score >= 60 
                  ? 'bg-amber-500/5 border-amber-500/20'
                  : 'bg-red-500/5 border-red-500/20'
              )}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Schedule Score</p>
                    <p className={cn('text-3xl font-bold', scoreColor)}>{score}<span className="text-lg text-muted-foreground/50">/100</span></p>
                  </div>
                  <div className="text-right">
                    <p className={cn('text-sm font-semibold', scoreColor)}>
                      {score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : 'Needs Attention'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 max-w-[180px]">
                      {score >= 80 ? 'Well optimized' : score >= 60 ? 'Room for improvement' : 'Several conflicts detected'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Executive Summary */}
              {(parsed.executive_summary || parsed.conflicts_summary) && (
                <div className="p-5 bg-secondary/40 rounded-xl border border-border/30">
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-sky-500" />
                    Summary
                  </h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {parsed.executive_summary || parsed.conflicts_summary}
                  </p>
                </div>
              )}

              {/* Critical Issues */}
              {parsed.critical_issues && parsed.critical_issues.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    Critical Issues
                  </h4>
                  <div className="space-y-2">
                    {parsed.critical_issues.map((item, i) => (
                      <div key={i} className="p-4 bg-red-500/5 border border-red-500/15 rounded-xl">
                        <div className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-md bg-red-500/15 flex items-center justify-center shrink-0 mt-0.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-foreground">{item.issue}</p>
                            <span className="text-[10px] text-red-500 mt-1.5 inline-block px-2 py-0.5 rounded-full bg-red-500/10 font-medium uppercase">
                              {item.urgency || 'Immediate'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Wins */}
              {parsed.quick_wins && parsed.quick_wins.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-emerald-500" />
                    Quick Wins
                  </h4>
                  <div className="space-y-2">
                    {parsed.quick_wins.map((win, i) => (
                      <div key={i} className="flex items-center gap-2.5 p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-lg">
                        <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                        <p className="text-xs text-muted-foreground">{win}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {suggestions.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    Recommendations
                  </h4>
                  <div className="space-y-2.5">
                    {suggestions.map((rec, i) => (
                      <div key={i} className={cn(
                        'p-4 rounded-xl border-l-2 border border-border/30 bg-secondary/20 hover:bg-secondary/40 transition-colors',
                        rec.priority === 'high' ? 'border-l-red-500' :
                        rec.priority === 'medium' ? 'border-l-amber-500' :
                        'border-l-emerald-500'
                      )}>
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <h5 className="font-medium text-sm text-foreground">{rec.title}</h5>
                                {rec.priority && (
                                  <span className={cn(
                                  'text-[9px] px-1.5 py-0.5 rounded-full uppercase font-semibold',
                                  rec.priority === 'high' ? 'bg-red-500/15 text-red-500' :
                                  rec.priority === 'medium' ? 'bg-amber-500/15 text-amber-500' :
                                  'bg-emerald-500/15 text-emerald-500'
                                  )}>
                                    {rec.priority}
                                  </span>
                                )}
                              </div>
                              {rec.rationale && (
                              <p className="text-xs text-muted-foreground mb-2 leading-relaxed">{rec.rationale}</p>
                              )}
                              {rec.action && (
                              <div className="flex items-center gap-1.5 text-xs text-teal-500 font-medium">
                                  <ArrowRight className="h-3 w-3" />
                                  <span>{rec.action}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border/50 px-6 py-4 flex items-center justify-between bg-secondary/20">
          <p className="text-[10px] text-muted-foreground/60">
            AI-powered analysis based on your calendar
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
