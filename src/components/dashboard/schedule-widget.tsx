'use client';

/**
 * EmergentOS - Schedule Widget
 * 
 * Displays today's calendar events from /api/calendar/events
 * Shows conflicts, locations, meeting times, and calendar insights.
 */

import { useState, useEffect, useCallback } from 'react';
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
  Sparkles,
} from 'lucide-react';
import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useSyncManager } from '@/lib/sync-manager';
import { cn } from '@/lib/utils';
import { SuggestionsModal, type CalendarInsight } from './suggestions-modal';

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
  const { providers, isSyncing, isInitialized } = useSyncManager();
  
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [insight, setInsight] = useState<CalendarInsight | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInsightsModalOpen, setIsInsightsModalOpen] = useState(false);

  const calendarStatus = providers.calendar.status;
  const isConnected = calendarStatus === 'connected';

  // ============================================================================
  // Fetch Events
  // ============================================================================

  const fetchEvents = useCallback(async () => {
    if (!user?.id || !isConnected) {
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/calendar/events?today=true');
      
      if (response.ok) {
        const data = await response.json();
        setEvents(data.events || []);
        setError(null);
      } else {
        setError('Failed to load events');
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

  const conflictCount = events.filter(e => e.has_conflict).length;

    return (
    <>
      <Card className="p-5 h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="widget-header">
            <div className="widget-icon bg-gradient-to-br from-sky-500/20 to-blue-500/10 ring-1 ring-sky-500/20">
              <Calendar className="h-5 w-5 text-sky-400" />
            </div>
            <div>
              <h3 className="widget-title">Today&apos;s Schedule</h3>
              <p className="widget-subtitle">
                {isConnected 
                  ? `${events.length} event${events.length !== 1 ? 's' : ''}${conflictCount > 0 ? ` • ${conflictCount} conflict${conflictCount !== 1 ? 's' : ''}` : ''}`
                  : 'Not connected'}
              </p>
            </div>
          </div>
          {/* View Analysis Button */}
          {isConnected && insight && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsInsightsModalOpen(true)}
              className="h-8 px-2 text-xs gap-1.5 text-amber-500 hover:text-amber-400 hover:bg-amber-500/10"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Analysis</span>
            </Button>
          )}
        </div>
                
        {/* Events List */}
        <div className="flex-1 overflow-y-auto -mx-1 px-1 min-h-0 eos-scrollbar-thin">
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
            <div className="space-y-2">
              {/* Upcoming Events */}
              {upcomingEvents.map((event) => (
                <EventCard key={event.id} event={event} isPast={false} />
              ))}
              
              {/* Past Events */}
              {pastEvents.length > 0 && upcomingEvents.length > 0 && (
                <div className="flex items-center gap-2 py-2">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Completed</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              {pastEvents.map((event) => (
                <EventCard key={event.id} event={event} isPast={true} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 mt-3 border-t border-border flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {isConnected && providers.calendar.lastSyncAt && (
              <>Last sync: {new Date(providers.calendar.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
            )}
          </span>
          {conflictCount > 0 && (
            <button
              onClick={() => setIsInsightsModalOpen(true)}
              className="text-[10px] text-red-400 flex items-center gap-1 hover:text-red-300 transition-colors"
            >
              <AlertTriangle className="h-3 w-3" />
              {conflictCount} conflict{conflictCount !== 1 ? 's' : ''} - View analysis
            </button>
          )}
        </div>
      </Card>

      {/* Insights Modal */}
      <SuggestionsModal
        isOpen={isInsightsModalOpen}
        onClose={() => setIsInsightsModalOpen(false)}
        insight={insight}
      />
    </>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

function EventCard({ event, isPast }: { event: CalendarEvent; isPast: boolean }) {
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
    <div className={cn(
      'group relative p-3 rounded-lg border transition-all',
      isPast && 'opacity-50',
      isHappening && 'bg-sky-500/10 border-sky-500/30',
      event.has_conflict && !isHappening && 'border-red-500/30 bg-red-500/5',
      !isHappening && !event.has_conflict && 'bg-secondary/30 border-border/50 hover:bg-secondary/50'
    )}>
      {/* Time indicator */}
      {isHappening && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-sky-500 rounded-l-lg" />
      )}
      {event.has_conflict && !isHappening && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 rounded-l-lg" />
      )}

      <div className="flex items-start gap-3">
        {/* Time Column */}
        <div className="shrink-0 w-16 text-right">
          {event.is_all_day ? (
            <span className="text-xs font-medium text-muted-foreground">All day</span>
          ) : (
            <>
              <div className="text-sm font-semibold text-foreground">
                {formatTime(startTime)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {durationStr}
              </div>
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className={cn(
              'text-sm font-medium truncate',
              isPast ? 'text-muted-foreground line-through' : 'text-foreground'
            )}>
              {event.title}
            </h4>
            {isHappening && (
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500 text-white font-medium animate-pulse">
                NOW
              </span>
            )}
            {event.has_conflict && !isHappening && (
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-medium">
                CONFLICT
              </span>
            )}
          </div>

          {/* Meta Info */}
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {event.location && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                {isVirtual ? (
                  <Video className="h-3 w-3 text-sky-400" />
                ) : (
                  <MapPin className="h-3 w-3" />
                )}
                <span className="truncate max-w-[120px]">{event.location}</span>
              </span>
            )}
            {event.attendees && event.attendees.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Users className="h-3 w-3" />
                {event.attendees.length}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
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
          <Sparkles className="h-3 w-3 text-amber-500" />
          View Weekly Analysis
        </Button>
        )}
      </div>
  );
}
