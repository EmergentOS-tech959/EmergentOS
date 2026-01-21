'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { 
  X, 
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
  const scoreBg = score >= 80 ? 'bg-green-500/10' : score >= 60 ? 'bg-amber-500/10' : 'bg-red-500/10';

  const suggestions = parsed?.recommendations || parsed?.suggestions || [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-[95vw] h-[85vh] max-h-[800px] p-0 flex flex-col bg-white dark:bg-[#0d1117] border-gray-200 dark:border-[#30363d]">
        {/* Header */}
        <div className="shrink-0 px-6 py-5 border-b border-gray-200 dark:border-[#30363d]">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500/30 to-orange-500/20 flex items-center justify-center ring-1 ring-amber-500/30">
                <Sparkles className="h-6 w-6 text-amber-500" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white">
                  Time Sovereignty Analysis
                </DialogTitle>
                <div className="flex items-center gap-3 mt-1">
                  {(insight?.conflicts_count ?? 0) > 0 && (
                    <span className="text-sm text-amber-500 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {insight?.conflicts_count} conflict{(insight?.conflicts_count ?? 0) !== 1 ? 's' : ''}
                    </span>
                  )}
                  {generatedTimeDisplay && (
                    <span className="text-sm text-gray-500 flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {generatedTimeDisplay}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-9 w-9 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!parsed ? (
            <div className="text-center py-12">
              <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No analysis data available.</p>
              <p className="text-sm text-gray-400 mt-1">Sync your calendar and run analysis to see insights.</p>
            </div>
          ) : (
            <>
              {/* Score Card */}
              <div className={cn('p-5 rounded-xl', scoreBg)}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Time Sovereignty Score</p>
                    <p className={cn('text-4xl font-bold mt-1', scoreColor)}>{score}/100</p>
                  </div>
                  <div className="text-right">
                    <p className={cn('text-lg font-semibold', scoreColor)}>
                      {score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : 'Needs Attention'}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      {score >= 80 ? 'Your schedule is well optimized' : score >= 60 ? 'Some improvements possible' : 'Several conflicts detected'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Executive Summary */}
              {(parsed.executive_summary || parsed.conflicts_summary) && (
                <div className="p-5 bg-gray-50 dark:bg-[#161b22] rounded-xl border border-gray-200 dark:border-[#30363d]">
                  <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-blue-500" />
                    Summary
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                    {parsed.executive_summary || parsed.conflicts_summary}
                  </p>
                </div>
              )}

              {/* Critical Issues */}
              {parsed.critical_issues && parsed.critical_issues.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    Critical Issues
                  </h4>
                  <div className="space-y-2">
                    {parsed.critical_issues.map((item, i) => (
                      <div key={i} className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg">
                        <div className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center shrink-0 mt-0.5">
                            <AlertTriangle className="h-3 w-3 text-red-500" />
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-sm text-gray-900 dark:text-white">{item.issue}</p>
                            <span className="text-xs text-red-600 dark:text-red-400 mt-1 inline-block">
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
                <div className="space-y-3">
                  <h4 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <Zap className="h-4 w-4 text-green-500" />
                    Quick Wins
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {parsed.quick_wins.map((win, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-lg">
                        <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                        <p className="text-sm text-gray-700 dark:text-gray-300">{win}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {suggestions.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    Recommendations
                  </h4>
                  <div className="space-y-3">
                    {suggestions.map((rec, i) => {
                      const priorityColors = {
                        high: 'border-l-red-500 bg-red-50 dark:bg-red-500/10',
                        medium: 'border-l-amber-500 bg-amber-50 dark:bg-amber-500/10',
                        low: 'border-l-green-500 bg-green-50 dark:bg-green-500/10',
                      };
                      const colorClass = priorityColors[rec.priority as keyof typeof priorityColors] || priorityColors.medium;
                      
                      return (
                        <div key={i} className={cn('p-4 rounded-lg border-l-4', colorClass)}>
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h5 className="font-semibold text-sm text-gray-900 dark:text-white">{rec.title}</h5>
                                {rec.priority && (
                                  <span className={cn(
                                    'text-[10px] px-2 py-0.5 rounded-full uppercase font-medium',
                                    rec.priority === 'high' ? 'bg-red-200 dark:bg-red-500/30 text-red-700 dark:text-red-300' :
                                    rec.priority === 'medium' ? 'bg-amber-200 dark:bg-amber-500/30 text-amber-700 dark:text-amber-300' :
                                    'bg-green-200 dark:bg-green-500/30 text-green-700 dark:text-green-300'
                                  )}>
                                    {rec.priority}
                                  </span>
                                )}
                              </div>
                              {rec.rationale && (
                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{rec.rationale}</p>
                              )}
                              {rec.action && (
                                <div className="flex items-center gap-2 text-sm text-teal-600 dark:text-teal-400">
                                  <ArrowRight className="h-3 w-3" />
                                  <span>{rec.action}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-200 dark:border-[#30363d] px-6 py-4 flex items-center justify-between bg-gray-50 dark:bg-[#0d1117]/80">
          <p className="text-xs text-gray-500">
            AI-powered analysis based on your calendar data
          </p>
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
