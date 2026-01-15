'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar, Clock, MapPin, AlertTriangle, Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase-client';
import { useUser } from '@clerk/nextjs';

interface CalendarEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  location?: string;
  has_conflict: boolean;
  status: 'confirmed' | 'tentative' | 'cancelled';
  attendees?: unknown[];
}

export function ScheduleWidget() {
  const { user } = useUser();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  useEffect(() => {
    const fetchEvents = async () => {
      if (!user?.id) return;
      
      try {
        setIsLoading(true);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const { data, error } = await supabase
          .from('calendar_events')
          .select('*')
          .eq('user_id', user.id)
          .gte('start_time', todayStart.toISOString())
          .lte('start_time', todayEnd.toISOString())
          .order('start_time', { ascending: true });

        if (error) throw error;
        setEvents(data || []);
      } catch (error) {
        console.error('Error fetching events:', error);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchEvents();
  }, [user?.id]);

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], { 
      hour: 'numeric', 
      minute: '2-digit' 
    });
  };

  const getEventStatusColor = (event: CalendarEvent) => {
    if (event.has_conflict) return 'border-status-amber bg-status-amber/5';
    if (event.status === 'cancelled') return 'border-status-red bg-status-red/5 opacity-60';
    
    // Check if event is current
    const now = new Date();
    const start = new Date(event.start_time);
    const end = new Date(event.end_time);
    
    if (now >= start && now <= end) return 'border-primary bg-primary/5';
    
    return 'border-transparent bg-secondary/30';
  };

  if (isLoading) {
    return (
      <Card className="col-span-1 p-6 border-border h-full min-h-[300px]">
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="col-span-1 p-6 border-border h-full flex flex-col min-h-[300px]">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold text-lg">Today&apos;s Schedule</h3>
        </div>
        <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-1 rounded">
          {events.length} Events
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1 eos-scrollbar max-h-[400px]">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <p className="text-muted-foreground text-sm">No events scheduled for today.</p>
            <Button variant="link" className="text-primary text-xs mt-2">
              Sync Calendar
            </Button>
          </div>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className={cn(
                "group relative p-3 rounded-lg border-l-2 transition-all hover:bg-secondary/50 cursor-pointer",
                getEventStatusColor(event)
              )}
              onClick={() => {
                setExpandedEventId(prev => (prev === event.id ? null : event.id));
              }}
            >
              {event.has_conflict && (
                <div className="absolute top-2 right-2 text-status-amber" title="Conflict Detected">
                  <AlertTriangle className="h-3 w-3" />
                </div>
              )}
              
              <div className="flex justify-between items-start mb-1">
                <h4 className={cn(
                  "font-medium text-sm truncate pr-6",
                  event.status === 'cancelled' && "line-through"
                )}>
                  {event.title}
                </h4>
              </div>
              
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>
                    {formatTime(event.start_time)} - {formatTime(event.end_time)}
                  </span>
                </div>
                {event.location && (
                  <div className="flex items-center gap-1 truncate max-w-[100px]">
                    {event.location.includes('http') ? (
                      <Video className="h-3 w-3" />
                    ) : (
                      <MapPin className="h-3 w-3" />
                    )}
                    <span>{event.location.includes('http') ? 'Online' : event.location}</span>
                  </div>
                )}
              </div>

              {expandedEventId === event.id && (
                <div className="mt-3 border-t border-border pt-3 space-y-2 text-xs text-muted-foreground">
                  {event.attendees && event.attendees.length > 0 && (
                    <div>Attendees: {event.attendees.length}</div>
                  )}
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-xs">
                      Reschedule
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs">
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
