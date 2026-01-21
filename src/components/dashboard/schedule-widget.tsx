'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Calendar, 
  Clock, 
  MapPin, 
  AlertTriangle, 
  Video, 
  Sparkles,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { CalendarModal } from './calendar-modal';
import { SuggestionsModal } from './suggestions-modal';
import { useSyncManager } from '@/lib/sync-manager';

interface CalendarEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  location?: string;
  description?: string;
  has_conflict: boolean;
  status: 'confirmed' | 'tentative' | 'cancelled';
  attendees?: unknown[];
}

interface CalendarInsight {
  analysis_date: string;
  conflicts_count: number;
  suggestions: string;
  generated_at: string;
}

export function ScheduleWidget() {
  const { user } = useUser();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [insight, setInsight] = useState<CalendarInsight | null>(null);
  
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [showSuggestionsModal, setShowSuggestionsModal] = useState(false);

  // Use centralized sync manager - displayStrings.calendar shows calendar-specific sync time
  // NOTE: Refresh button removed - use unified refresh in dashboard header
  const { providers, displayStrings } = useSyncManager();
  const calendarProvider = providers.calendar;
  const calendarStatus = calendarProvider.status === 'syncing' ? 'connected' : calendarProvider.status;

  const fetchEvents = useCallback(async () => {
      if (!user?.id) return;
      try {
        setIsLoading(true);
      const res = await fetch('/api/integrations/calendar/events', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setEvents(body?.events || []);
    } catch (e) {
      console.error('Error fetching events:', e);
      } finally {
        setIsLoading(false);
      }
  }, [user?.id]);

  const fetchInsight = useCallback(async () => {
    if (!user?.id) return;
    try {
      // CRITICAL: Use cache: 'no-store' to always get fresh data
      const res = await fetch('/api/integrations/calendar/insights', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setInsight(body?.insight || null);
    } catch { /* non-blocking */ }
  }, [user?.id]);

  // NOTE: handleSync removed - use unified refresh button in dashboard header

  // Initial load
  useEffect(() => {
    void fetchEvents();
    void fetchInsight();
  }, [fetchEvents, fetchInsight]);

  // CRITICAL: Refetch when calendar sync completes (lastSyncAt changes)
  // This is more reliable than listening to custom events
  const lastSyncAtRef = useRef<string | null>(null);
  useEffect(() => {
    // Only refetch if lastSyncAt actually changed (not on initial mount)
    if (calendarProvider.lastSyncAt && calendarProvider.lastSyncAt !== lastSyncAtRef.current) {
      const wasNull = lastSyncAtRef.current === null;
      lastSyncAtRef.current = calendarProvider.lastSyncAt;
      
      // Skip initial mount, only refetch on subsequent changes
      if (!wasNull) {
        console.log('[ScheduleWidget] Calendar lastSyncAt changed, refetching...');
        void fetchEvents();
        void fetchInsight();
      }
    }
  }, [calendarProvider.lastSyncAt, fetchEvents, fetchInsight]);

  // Also listen for custom event as backup
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ providers?: string[]; phase?: string; syncedProviders?: string[] }>;
      if (ce?.detail?.phase !== 'complete') return;
      // Check both providers and syncedProviders arrays
      const hasCalendar = 
        ce?.detail?.providers?.includes('calendar') || 
        ce?.detail?.syncedProviders?.includes('calendar');
      if (hasCalendar) {
        console.log('[ScheduleWidget] eos:connections-updated event received for calendar');
        void fetchEvents();
        void fetchInsight();
      }
    };
    window.addEventListener('eos:connections-updated', handler as EventListener);
    return () => window.removeEventListener('eos:connections-updated', handler as EventListener);
  }, [fetchEvents, fetchInsight]);

  // Listen for calendar disconnection - clear events and insights
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ provider?: string }>;
      if (ce?.detail?.provider === 'calendar') {
        setEvents([]);
        setInsight(null);
      }
    };
    window.addEventListener('eos:provider-disconnected', handler as EventListener);
    return () => window.removeEventListener('eos:provider-disconnected', handler as EventListener);
  }, []);

  const todayEvents = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return events
      .filter((e) => new Date(e.start_time).toISOString().split('T')[0] === today)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }, [events]);

  const actualConflictCount = useMemo(() => {
    return events.filter((e) => e.has_conflict && e.status !== 'cancelled').length;
  }, [events]);

  const formatTime = (dateStr: string) => new Date(dateStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const isCurrentEvent = (event: CalendarEvent) => {
    const now = Date.now();
    return now >= new Date(event.start_time).getTime() && now <= new Date(event.end_time).getTime();
  };

  const handleEventCreate = async (event: Partial<CalendarEvent>) => {
    const res = await fetch('/api/integrations/calendar/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed');
    // Auto-refresh after create
    await fetchEvents();
    await fetchInsight();
  };

  const handleEventUpdate = async (id: string, event: Partial<CalendarEvent>) => {
    const res = await fetch(`/api/integrations/calendar/events/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result?.error || 'Failed');
    // Auto-refresh after update
    await fetchEvents();
    // Also refresh insights - time changes may affect conflicts
    await fetchInsight();
  };

  const handleEventDelete = async (id: string) => {
    const res = await fetch(`/api/integrations/calendar/events/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed');
    // Auto-refresh after delete
    await fetchEvents();
    await fetchInsight();
  };

  if (isLoading) {
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
                {calendarStatus === 'connected' 
                  ? `${todayEvents.length} event${todayEvents.length !== 1 ? 's' : ''}`
                  : 'Not connected'}
              </p>
      </div>
          </div>
          
          {actualConflictCount > 0 && (
            <button 
              onClick={() => setShowSuggestionsModal(true)}
              className="flex items-center gap-1.5 text-status-amber bg-status-amber/10 hover:bg-status-amber/15 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors border border-status-amber/20"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {actualConflictCount}
            </button>
          )}
        </div>

        {/* AI Insights Card */}
        {calendarStatus === 'connected' && insight?.suggestions && (
          <button 
            onClick={() => setShowSuggestionsModal(true)}
            className="mb-4 p-3 bg-gradient-copper border border-ai-copper/20 rounded-xl text-left transition-all hover:border-ai-copper/30 group"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-ai-copper shrink-0" />
              <span className="text-xs font-semibold text-ai-copper flex-1">Strategic Insights Available</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-ai-copper transition-colors" />
                </div>
          </button>
              )}
              
        {/* Events List */}
        <div className="flex-1 overflow-y-auto -mx-1 px-1 min-h-0 eos-scrollbar-thin">
          {calendarStatus === 'disconnected' ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-6">
              <div className="w-14 h-14 rounded-2xl bg-secondary/50 flex items-center justify-center mb-4">
                <Calendar className="h-7 w-7 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">Calendar Not Connected</p>
              <p className="text-xs text-muted-foreground mb-4">Connect to see your schedule</p>
              <Link href="/settings">
                <Button variant="outline" size="sm" className="h-8 text-xs font-medium">Connect Calendar</Button>
              </Link>
            </div>
          ) : calendarStatus === 'error' ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-6">
              <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
                <AlertTriangle className="h-7 w-7 text-destructive/70" />
              </div>
              <p className="text-sm font-medium text-destructive mb-1">Sync Error</p>
              <p className="text-xs text-muted-foreground mb-4">Failed to sync calendar</p>
              <p className="text-xs text-muted-foreground">Use the Refresh button above</p>
            </div>
          ) : todayEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-6">
              <div className="w-14 h-14 rounded-2xl bg-secondary/50 flex items-center justify-center mb-4">
                <Calendar className="h-7 w-7 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">No Events Today</p>
              <p className="text-xs text-muted-foreground">Your schedule is clear</p>
                </div>
          ) : (
            <div className="space-y-2">
              {todayEvents.slice(0, 4).map((event) => {
                const isCurrent = isCurrentEvent(event);
                return (
                  <button
                    key={event.id}
                    onClick={() => setShowCalendarModal(true)}
                    className={cn(
                      'w-full p-3.5 rounded-xl text-left transition-all relative overflow-hidden',
                      'border-l-[3px]',
                      event.has_conflict 
                        ? 'bg-status-amber/5 border-l-status-amber hover:bg-status-amber/10' 
                        : event.status === 'cancelled'
                          ? 'bg-destructive/5 border-l-destructive/40 opacity-50'
                          : isCurrent
                            ? 'bg-primary/5 border-l-primary hover:bg-primary/10'
                            : 'bg-secondary/50 border-l-transparent hover:bg-secondary/80 border border-transparent hover:border-border'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className={cn(
                          'font-medium text-sm text-foreground truncate',
                          event.status === 'cancelled' && 'line-through'
                        )}>
                          {event.title}
                        </p>
                        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatTime(event.start_time)}
                          </span>
                          {event.location && (
                            <span className="flex items-center gap-1 truncate">
                              {event.location.includes('http') ? <Video className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                              <span className="truncate max-w-[80px]">
                                {event.location.includes('http') ? 'Online' : event.location}
                              </span>
                            </span>
                          )}
                        </div>
                  </div>
                      {event.has_conflict && <AlertTriangle className="h-4 w-4 text-status-amber shrink-0" />}
                      {isCurrent && !event.has_conflict && (
                        <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse shrink-0 mt-1" />
                )}
              </div>
                  </button>
                );
              })}
              {todayEvents.length > 4 && (
                <button 
                  onClick={() => setShowCalendarModal(true)}
                  className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
                >
                  +{todayEvents.length - 4} more events
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer - CRITICAL: Show calendar-specific sync time */}
        <div className="pt-3 mt-3 border-t border-border flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {calendarStatus === 'connected' && `Synced ${displayStrings.calendar}`}
          </span>
          
          {calendarStatus === 'connected' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] gap-1.5 text-muted-foreground hover:text-foreground px-2 font-medium"
              onClick={() => setShowCalendarModal(true)}
            >
              Open Calendar
              <ExternalLink className="h-3 w-3" />
            </Button>
        )}
      </div>
    </Card>

      <CalendarModal
        isOpen={showCalendarModal}
        onClose={() => setShowCalendarModal(false)}
        events={events}
        onEventCreate={handleEventCreate}
        onEventUpdate={handleEventUpdate}
        onEventDelete={handleEventDelete}
        isConnected={calendarStatus === 'connected'}
        lastSyncDisplay={displayStrings.calendar}
      />

      <SuggestionsModal
        isOpen={showSuggestionsModal}
        onClose={() => setShowSuggestionsModal(false)}
        insight={insight ? {
          conflicts_count: actualConflictCount,
          suggestions: insight.suggestions,
          generated_at: insight.generated_at,
        } : null}
      />
    </>
  );
}
