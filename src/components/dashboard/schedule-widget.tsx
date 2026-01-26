'use client';

/**
 * EmergentOS - Schedule Widget
 * 
 * Displays today's calendar events from /api/calendar/events
 * Shows conflicts, locations, meeting times, and calendar insights.
 * Enhanced with analysis summary display and calendar view modal.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Calendar, 
  AlertTriangle, 
  Clock,
  MapPin,
  Users,
  Video,
  RefreshCw,
  ChevronRight,
  CalendarDays,
  TrendingUp,
  TrendingDown,
  Minus,
  Brain,
} from 'lucide-react';
import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useSyncManager } from '@/lib/sync-manager';
import { cn } from '@/lib/utils';
import { SuggestionsModal, type CalendarInsight } from './suggestions-modal';
import { CalendarModal } from './calendar-modal';

// ============================================================================
// Types
// ============================================================================

interface CalendarEvent {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  location: string | null;
  attendees: Array<{
    email: string;
    displayName?: string;
    responseStatus: string;
  }>;
  organizer: string | null;
  has_conflict: boolean;
  conflict_with: string[];
}

// ============================================================================
// Main Component
// ============================================================================

export function ScheduleWidget() {
  const { user, isLoaded } = useUser();
  const { providers, isInitialized, displayStrings } = useSyncManager();
  
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([]); // For calendar modal
  const [insight, setInsight] = useState<CalendarInsight | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInsightsModalOpen, setIsInsightsModalOpen] = useState(false);
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);
  const [selectedEventDate, setSelectedEventDate] = useState<Date | null>(null);

  const calendarStatus = providers.calendar.status;
  const isConnected = calendarStatus === 'connected';

  // Handler to open calendar modal on a specific event date
  const handleEventClick = useCallback((event: CalendarEvent) => {
    setSelectedEventDate(new Date(event.start_time));
    setIsCalendarModalOpen(true);
  }, []);

  // Calculate unique conflict PAIRS (not events with conflicts)
  // Each scheduling conflict involves 2 events, so we count unique pairs
  // NOTE: Must be called before any early returns to comply with React hooks rules
  const conflictPairCount = useMemo(() => {
    const seenPairs = new Set<string>();
    for (const event of events) {
      if (event.has_conflict && event.conflict_with?.length) {
        for (const conflictId of event.conflict_with) {
          // Create sorted pair key to avoid counting A-B and B-A as separate
          const pairKey = [event.event_id, conflictId].sort().join('|');
          seenPairs.add(pairKey);
        }
      }
    }
    return seenPairs.size;
  }, [events]);

  // ============================================================================
  // Fetch Events
  // ============================================================================

  const fetchEvents = useCallback(async () => {
    if (!user?.id || !isConnected) {
      setIsLoading(false);
      return;
    }

    try {
      // Fetch today's events for the widget
      const todayResponse = await fetch('/api/calendar/events?today=true');
      
      if (todayResponse.ok) {
        const data = await todayResponse.json();
        setEvents(data.events || []);
        setError(null);
      } else {
        setError('Failed to load events');
      }

      // Fetch all events for the calendar modal (30 day window)
      const allResponse = await fetch('/api/calendar/events');
      if (allResponse.ok) {
        const allData = await allResponse.json();
        setAllEvents(allData.events || []);
      }
    } catch (err) {
      console.error('[ScheduleWidget] Fetch error:', err);
      setError('Failed to load events');
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, isConnected]);

  // ============================================================================
  // Fetch Calendar Insights
  // ============================================================================

  const fetchInsights = useCallback(async () => {
    if (!user?.id || !isConnected) {
      return;
    }

    try {
      const response = await fetch('/api/calendar/insights');
      
      if (response.ok) {
        const data = await response.json();
        if (data.found && data.insight) {
          setInsight(data.insight);
        } else {
          setInsight(null);
        }
      }
    } catch (err) {
      console.error('[ScheduleWidget] Insights fetch error:', err);
    }
  }, [user?.id, isConnected]);

  // ============================================================================
  // Effects
  // ============================================================================

  useEffect(() => {
    if (isLoaded && user?.id) {
      fetchEvents();
      fetchInsights();
    }
  }, [isLoaded, user?.id, fetchEvents, fetchInsights]);

  // Listen for connection updates
  useEffect(() => {
    const handleConnectionsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail?.phase === 'complete') {
        fetchEvents();
        fetchInsights();
      }
    };

    window.addEventListener('eos:connections-updated', handleConnectionsUpdated);
    return () => {
      window.removeEventListener('eos:connections-updated', handleConnectionsUpdated);
    };
  }, [fetchEvents, fetchInsights]);

  // ============================================================================
  // Render
  // ============================================================================

  if (!isLoaded || !user || !isInitialized) {
    return <ScheduleLoadingSkeleton />;
  }

  const upcomingEvents = events.filter(event => {
    const now = new Date();
    const eventEnd = new Date(event.end_time);
    return eventEnd > now;
  });

  const pastEvents = events.filter(event => {
    const now = new Date();
    const eventEnd = new Date(event.end_time);
    return eventEnd <= now;
  });

  // Extract analysis summary data
  const analysisContent = insight?.content;
  const healthScore = (analysisContent?.healthScore as number) ?? (analysisContent?.weeklyInsights as { balanceScore?: number })?.balanceScore ?? null;
  const verdict = (analysisContent?.verdict as string) ?? null;
  const executiveSummary = (analysisContent?.executiveSummary as string) ?? null;

  // Determine health indicator
  const getHealthIndicator = () => {
    if (healthScore === null) return null;
    if (healthScore >= 80) return { icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-500/10' };
    if (healthScore >= 60) return { icon: Minus, color: 'text-amber-500', bg: 'bg-amber-500/10' };
    return { icon: TrendingDown, color: 'text-red-500', bg: 'bg-red-500/10' };
  };

  const healthIndicator = getHealthIndicator();

    return (
    <>
      <Card className="flex flex-col h-full overflow-hidden border bg-card shadow-sm transition-all duration-200 hover:shadow-md">
        {/* Header - Clean title bar with action buttons */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/20 to-blue-500/10 text-sky-500">
              <Calendar className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-semibold tracking-tight text-foreground">Today&apos;s Schedule</h3>
          </div>
          
          {/* Action Buttons - Icon only */}
          {isConnected && (
            <div className="flex items-center gap-1">
              {/* AI Analysis Button - Icon only */}
              {insight && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsInsightsModalOpen(true)}
                  className="w-8 h-8 text-violet-500 hover:text-violet-600 hover:bg-violet-500/10 transition-colors"
                  title="View AI Analysis"
                >
                  <Brain className="w-4 h-4" />
                </Button>
              )}
              {/* Calendar View Button */}
            <Button
              variant="ghost"
                size="icon"
                onClick={() => setIsCalendarModalOpen(true)}
                className="w-8 h-8 text-muted-foreground transition-colors hover:text-foreground hover:bg-secondary/50"
                title="Open Calendar View"
              >
                <CalendarDays className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Analysis Summary Bar - Only show when connected and insight exists */}
        {isConnected && insight && executiveSummary && (
          <div className="px-5 pb-4">
            <button
              onClick={() => setIsInsightsModalOpen(true)}
              className="w-full group relative overflow-hidden rounded-xl bg-gradient-to-br from-violet-500/5 via-secondary/40 to-purple-500/5 border border-violet-500/10 p-4 text-left transition-all hover:border-violet-500/30 hover:shadow-sm"
            >
              {/* Meta info row - Event count, conflicts on left; timestamp on right */}
              <div className="flex items-center justify-between mb-3 text-[11px]">
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground font-medium">
                    {events.length} event{events.length !== 1 ? 's' : ''} today
                  </span>
                  {conflictPairCount > 0 ? (
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/15 text-red-500 font-semibold border border-red-500/20">
                      <AlertTriangle className="w-3 h-3" />
                      {conflictPairCount} conflict{conflictPairCount !== 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-emerald-500/80 font-medium">
                      No conflicts
                    </span>
                  )}
                </div>
                {displayStrings.calendar && displayStrings.calendar !== 'Never synced' && (
                  <span className="flex items-center gap-1 text-muted-foreground/70">
                    <Clock className="w-3 h-3" />
                    {displayStrings.calendar}
                  </span>
                )}
              </div>
              
              <div className="flex items-start gap-4">
                {/* Health Score Indicator */}
                {healthIndicator && (
                  <div className={cn(
                    'shrink-0 w-12 h-12 rounded-xl flex flex-col items-center justify-center',
                    healthIndicator.bg,
                    'border border-transparent'
                  )}>
                    <span className={cn('text-lg font-bold', healthIndicator.color)}>
                      {healthScore}
                    </span>
                    <span className="text-[8px] font-medium text-muted-foreground -mt-0.5">score</span>
                  </div>
                )}
                
                {/* Summary Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Brain className="w-3.5 h-3.5 text-violet-500" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                      AI Analysis
                    </span>
                    {verdict && (
                      <span className={cn(
                        'text-[10px] px-2 py-0.5 rounded-full font-semibold',
                        verdict === 'OPTIMAL' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                        verdict === 'GOOD' && 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
                        verdict === 'CONCERNING' && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                        verdict === 'CRITICAL' && 'bg-red-500/15 text-red-600 dark:text-red-400'
                      )}>
                        {verdict}
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground line-clamp-2 group-hover:text-foreground/90 transition-colors">
                    {executiveSummary}
                  </p>
                </div>

                {/* See More Arrow */}
                <div className="flex items-center self-center">
                  <ChevronRight className="w-5 h-5 text-muted-foreground/30 transition-all group-hover:text-amber-500 group-hover:translate-x-0.5" />
                </div>
              </div>
            </button>
          </div>
        )}
        
        {/* When no AI analysis is available, show meta info separately */}
        {isConnected && (!insight || !executiveSummary) && (
          <div className="px-5 pb-3">
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground font-medium">
                  {events.length} event{events.length !== 1 ? 's' : ''} today
                </span>
                {conflictPairCount > 0 ? (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 font-semibold">
                    <AlertTriangle className="w-3 h-3" />
                    {conflictPairCount} conflict{conflictPairCount !== 1 ? 's' : ''}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-emerald-500/80 font-medium">
                    No conflicts
                  </span>
                )}
              </div>
              {displayStrings.calendar && displayStrings.calendar !== 'Never synced' && (
                <span className="flex items-center gap-1 text-muted-foreground/70">
                  <Clock className="w-3 h-3" />
                  {displayStrings.calendar}
                </span>
          )}
        </div>
          </div>
        )}
                
        {/* Events List */}
        <div className="flex-1 min-h-0 px-5 overflow-y-auto eos-scrollbar-thin">
          {calendarStatus === 'disconnected' ? (
            <DisconnectedState />
          ) : calendarStatus === 'error' ? (
            <ErrorState />
          ) : isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} onRetry={fetchEvents} />
          ) : events.length === 0 ? (
            <EmptyState hasInsight={!!insight} onViewInsights={() => setIsInsightsModalOpen(true)} />
          ) : (
            <div className="pb-4 space-y-1.5">
              {/* Upcoming Events */}
              {upcomingEvents.map((event) => (
                <EventCard key={event.id} event={event} isPast={false} onClick={() => handleEventClick(event)} />
              ))}
              
              {/* Past Events */}
              {pastEvents.length > 0 && upcomingEvents.length > 0 && (
                <div className="relative py-3">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-border/40"></div>
                  </div>
                  <div className="relative flex justify-center">
                    <span className="px-3 py-0.5 text-[10px] font-medium text-muted-foreground uppercase bg-card rounded-full">Earlier today</span>
                  </div>
                </div>
              )}
              {pastEvents.map((event) => (
                <EventCard key={event.id} event={event} isPast={true} onClick={() => handleEventClick(event)} />
              ))}
            </div>
          )}
        </div>

      </Card>

      {/* Insights Modal */}
      <SuggestionsModal
        isOpen={isInsightsModalOpen}
        onClose={() => setIsInsightsModalOpen(false)}
        insight={insight}
      />

      {/* Calendar View Modal */}
      <CalendarModal
        isOpen={isCalendarModalOpen}
        onClose={() => {
          setIsCalendarModalOpen(false);
          setSelectedEventDate(null);
        }}
        events={allEvents.map(e => ({
          id: e.id,
          event_id: e.event_id,
          title: e.title,
          start_time: e.start_time,
          end_time: e.end_time,
          location: e.location || undefined,
          description: e.description || undefined,
          has_conflict: e.has_conflict,
          conflict_with: e.conflict_with,
          status: 'confirmed' as const,
          attendees: e.attendees,
        }))}
        isConnected={isConnected}
        lastSyncDisplay={displayStrings.calendar || 'Never synced'}
        initialDate={selectedEventDate}
      />
    </>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

function EventCard({ event, isPast, onClick }: { event: CalendarEvent; isPast: boolean; onClick?: () => void }) {
  const startTime = new Date(event.start_time);
  const endTime = new Date(event.end_time);
  const now = new Date();
  
  const isHappening = !isPast && startTime <= now && endTime > now;
  const isVirtual = event.location?.toLowerCase().includes('zoom') || 
                    event.location?.toLowerCase().includes('meet') ||
                    event.location?.toLowerCase().includes('teams');

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
  const durationStr = durationMinutes >= 60 
    ? `${Math.floor(durationMinutes / 60)}h${durationMinutes % 60 > 0 ? ` ${durationMinutes % 60}m` : ''}`
    : `${durationMinutes}m`;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full group relative flex items-center gap-3 rounded-xl p-3 text-left transition-all duration-200 border',
        isPast ? 'opacity-50 border-transparent' : 'hover:bg-secondary/50 hover:border-border/50 cursor-pointer border-transparent',
        isHappening && 'bg-primary/5 border-primary/30 ring-1 ring-primary/20',
        event.has_conflict && !isHappening && 'bg-red-500/5 border-red-500/20 ring-1 ring-red-500/10'
      )}
    >
      {/* Left indicator bar - more prominent for conflicts */}
      <div className={cn(
        'absolute left-0 top-2 bottom-2 w-1.5 rounded-full transition-colors',
        isHappening ? 'bg-primary animate-pulse' :
        event.has_conflict ? 'bg-red-500' :
        isPast ? 'bg-muted-foreground/20' : 'bg-primary/20 group-hover:bg-primary/40'
      )} />

        {/* Content */}
      <div className="flex-1 min-w-0 pl-2">
        <div className="flex items-center gap-2">
            <h4 className={cn(
              'text-sm font-medium truncate',
            isPast ? 'text-muted-foreground line-through decoration-muted-foreground/50' : 'text-foreground'
            )}>
              {event.title}
            </h4>
          {/* Status Badges */}
            {isHappening && (
            <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-primary text-primary-foreground animate-pulse">
              Live
              </span>
            )}
            {event.has_conflict && !isHappening && (
            <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-red-500/15 text-red-600 dark:text-red-400">
              Conflict
              </span>
            )}
          </div>

          {/* Meta Info */}
        <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-muted-foreground">
            {event.location && (
            <span className="flex items-center gap-1">
                {isVirtual ? (
                <Video className="w-3 h-3 text-sky-500" />
                ) : (
                <MapPin className="w-3 h-3" />
                )}
              <span className="truncate max-w-[140px]">{event.location}</span>
              </span>
            )}
            {event.attendees && event.attendees.length > 0 && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

      {/* Time Column (Right) */}
      <div className="flex flex-col items-end shrink-0 text-right">
        {event.is_all_day ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1 bg-secondary/50 rounded-md">All day</span>
        ) : (
          <>
            <div className={cn(
              "text-sm font-semibold tabular-nums",
              isHappening ? "text-primary" : "text-foreground"
            )}>
              {formatTime(startTime)}
            </div>
            <div className="text-[10px] font-medium text-muted-foreground">
              {durationStr}
            </div>
          </>
        )}
      </div>

      {/* Chevron indicator on hover */}
      <ChevronRight className={cn(
        'w-4 h-4 text-muted-foreground/30 shrink-0 transition-all',
        'group-hover:text-muted-foreground group-hover:translate-x-0.5',
        isPast && 'opacity-0'
      )} />
    </button>
  );
}

function ScheduleLoadingSkeleton() {
    return (
      <Card className="p-5 h-full">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      </Card>
    );
  }

function LoadingState() {
  return (
    <div className="space-y-2.5">
      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
  );
}

function DisconnectedState() {
  return (
          <div className="flex flex-col items-center justify-center h-full text-center py-6">
            <div className="w-14 h-14 rounded-2xl bg-secondary/50 flex items-center justify-center mb-4">
              <Calendar className="h-7 w-7 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">Calendar Not Connected</p>
            <p className="text-xs text-muted-foreground mb-4">Connect to see your schedule</p>
            <Link href="/settings">
        <Button variant="outline" size="sm" className="h-8 text-xs font-medium">
          Connect Calendar
        </Button>
            </Link>
          </div>
  );
}

function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
          <div className="flex flex-col items-center justify-center h-full text-center py-6">
      <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
        <AlertTriangle className="h-7 w-7 text-red-400" />
            </div>
      <p className="text-sm font-medium text-foreground mb-1">
        {message || 'Sync Error'}
      </p>
      <p className="text-xs text-muted-foreground mb-4">Failed to load events</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onRetry}>
          <RefreshCw className="h-3 w-3 mr-2" />
          Retry
        </Button>
      )}
          </div>
  );
}

function EmptyState({ hasInsight, onViewInsights }: { hasInsight: boolean; onViewInsights: () => void }) {
  return (
          <div className="flex flex-col items-center justify-center h-full text-center py-6">
            <div className="w-14 h-14 rounded-2xl bg-secondary/50 flex items-center justify-center mb-4">
              <Calendar className="h-7 w-7 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">No Events Today</p>
      <p className="text-xs text-muted-foreground mb-4">Your schedule is clear</p>
      {hasInsight && (
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={onViewInsights}>
          <Brain className="h-3 w-3 text-violet-500" />
          View Weekly Analysis
        </Button>
        )}
      </div>
  );
}
