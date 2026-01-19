'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Calendar, 
  Clock, 
  MapPin, 
  AlertTriangle, 
  Video, 
  RefreshCw,
  Sparkles,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUser } from '@clerk/nextjs';
import { toast } from 'sonner';
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
  const { providers, syncCalendar, displayStrings } = useSyncManager();
  const calendarProvider = providers.calendar;
  const calendarStatus = calendarProvider.status === 'syncing' ? 'connected' : calendarProvider.status;
  // CRITICAL: Only show syncing when CALENDAR is syncing, not when other sources sync
  const isSyncing = calendarProvider.isSyncing;

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

  const handleSync = useCallback(async () => {
    if (!user?.id || calendarStatus === 'disconnected') return;
    
    try {
      await syncCalendar();
      // Wait for sync to complete then refetch
      await new Promise((r) => setTimeout(r, 2000));
      await Promise.all([fetchEvents(), fetchInsight()]);
      toast.success('Calendar synced');
    } catch {
      toast.error('Sync failed');
    }
  }, [user?.id, calendarStatus, syncCalendar, fetchEvents, fetchInsight]);

  // Initial load
  useEffect(() => {
    void fetchEvents();
    void fetchInsight();
  }, [fetchEvents, fetchInsight]);

  // Listen for sync completions
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ providers?: string[]; phase?: string }>;
      if (ce?.detail?.phase !== 'complete') return;
      // Refetch if calendar was synced (wait for analysis to complete)
      if (ce?.detail?.providers?.includes('calendar') || !ce?.detail?.providers) {
        // Calendar analysis runs during sync, wait for it to complete
        setTimeout(() => {
          void fetchEvents();
          void fetchInsight();
        }, 2000);
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
  };

  const handleEventDelete = async (id: string) => {
    const res = await fetch(`/api/integrations/calendar/events/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed');
  };

  if (isLoading) {
    return (
      <Card className="p-4 h-full">
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-7 w-7 rounded-full" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="p-4 h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Calendar className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Today&apos;s Schedule</h3>
              <p className="text-[11px] text-gray-500">
                {calendarStatus === 'connected' 
                  ? `${todayEvents.length} event${todayEvents.length !== 1 ? 's' : ''}`
                  : 'Not connected'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5">
            {actualConflictCount > 0 && (
              <button 
                onClick={() => setShowSuggestionsModal(true)}
                className="flex items-center gap-1 text-amber-400 bg-amber-500/15 hover:bg-amber-500/25 px-2 py-1 rounded-md text-xs font-medium transition-colors"
              >
                <AlertTriangle className="h-3 w-3" />
                {actualConflictCount}
              </button>
            )}
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSync}
              disabled={calendarStatus === 'disconnected' || isSyncing}
              className="h-7 w-7 p-0"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isSyncing && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* AI Insights Card */}
        {calendarStatus === 'connected' && insight?.suggestions && (
          <button 
            onClick={() => setShowSuggestionsModal(true)}
            className="mb-3 p-2.5 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 rounded-lg text-left transition-colors group"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span className="text-xs font-medium text-amber-400 flex-1">Strategic Insights</span>
              <ChevronRight className="h-3 w-3 text-gray-500 group-hover:text-amber-400 transition-colors" />
            </div>
          </button>
        )}

        {/* Events List */}
        <div className="flex-1 overflow-y-auto -mx-1 px-1 min-h-0">
          {calendarStatus === 'disconnected' ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-4">
              <Calendar className="h-8 w-8 text-gray-500 mb-2" />
              <p className="text-sm font-medium text-white mb-1">Not Connected</p>
              <Link href="/settings">
                <Button variant="outline" size="sm" className="h-7 text-xs">Connect Calendar</Button>
              </Link>
            </div>
          ) : calendarStatus === 'error' ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-4">
              <AlertTriangle className="h-8 w-8 text-red-400/50 mb-2" />
              <p className="text-sm font-medium text-red-400 mb-1">Sync Error</p>
              <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing} className="h-7 text-xs">
                {isSyncing ? 'Retrying...' : 'Retry'}
              </Button>
            </div>
          ) : todayEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-4">
              <Calendar className="h-8 w-8 text-gray-500 mb-2" />
              <p className="text-sm font-medium text-white">No Events Today</p>
              <p className="text-xs text-gray-500">Your schedule is clear</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {todayEvents.slice(0, 4).map((event) => {
                const isCurrent = isCurrentEvent(event);
                return (
                  <button
                    key={event.id}
                    onClick={() => setShowCalendarModal(true)}
                    className={cn(
                      'w-full p-2.5 rounded-lg text-left transition-all border-l-3',
                      event.has_conflict 
                        ? 'bg-amber-500/10 border-l-amber-500 hover:bg-amber-500/15' 
                        : event.status === 'cancelled'
                          ? 'bg-red-500/10 border-l-red-500/50 opacity-50'
                          : isCurrent
                            ? 'bg-teal-500/15 border-l-teal-500 hover:bg-teal-500/20'
                            : 'bg-gray-800/50 border-l-transparent hover:bg-gray-800/80'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className={cn(
                          'font-medium text-sm text-white truncate',
                          event.status === 'cancelled' && 'line-through'
                        )}>
                          {event.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatTime(event.start_time)}
                          </span>
                          {event.location && (
                            <span className="flex items-center gap-1 truncate">
                              {event.location.includes('http') ? <Video className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                              <span className="truncate max-w-[60px]">
                                {event.location.includes('http') ? 'Online' : event.location}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                      {event.has_conflict && <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />}
                      {isCurrent && !event.has_conflict && (
                        <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse shrink-0 mt-1.5" />
                      )}
                    </div>
                  </button>
                );
              })}
              {todayEvents.length > 4 && (
                <button 
                  onClick={() => setShowCalendarModal(true)}
                  className="w-full py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  +{todayEvents.length - 4} more events
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer - CRITICAL: Show calendar-specific sync time */}
        <div className="pt-2 mt-2 border-t border-gray-800 flex items-center justify-between">
          <span className="text-[10px] text-gray-500">
            {calendarStatus === 'connected' && `Synced ${displayStrings.calendar}`}
          </span>
          
          {calendarStatus === 'connected' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] gap-1 text-gray-400 hover:text-white px-2"
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
        onEventDelete={handleEventDelete}
        onRefresh={handleSync}
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
