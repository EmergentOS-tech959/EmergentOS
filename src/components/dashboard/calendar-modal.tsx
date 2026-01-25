'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  X, 
  Clock, 
  MapPin, 
  FileText,
  Trash2,
  AlertTriangle,
  CalendarDays
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

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

interface CalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  events: CalendarEvent[];
  onEventCreate?: (event: Partial<CalendarEvent>) => Promise<void>;
  onEventUpdate?: (id: string, event: Partial<CalendarEvent>) => Promise<void>;
  onEventDelete?: (id: string) => Promise<void>;
  isConnected: boolean;
  lastSyncDisplay: string;
}

const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const hours = Math.floor(i / 4);
  const minutes = (i % 4) * 15;
  const h = hours.toString().padStart(2, '0');
  const m = minutes.toString().padStart(2, '0');
  const period = hours < 12 ? 'AM' : 'PM';
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const label = `${displayHour}:${m} ${period}`;
  return { value: `${h}:${m}`, label };
});

export function CalendarModal({
  isOpen,
  onClose,
  events,
  onEventCreate,
  onEventDelete,
  isConnected,
  lastSyncDisplay,
}: CalendarModalProps) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    startTime: '09:00',
    endTime: '10:00',
    location: '',
    description: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const isToday = useMemo(() => {
    const today = new Date();
    return selectedDate.toDateString() === today.toDateString();
  }, [selectedDate]);

  const dayEvents = useMemo(() => {
    const dateStr = selectedDate.toISOString().split('T')[0];
    return events
      .filter(e => {
        const eventDate = new Date(e.start_time).toISOString().split('T')[0];
        const eventEndDate = new Date(e.end_time).toISOString().split('T')[0];
        return eventDate === dateStr || eventEndDate === dateStr || (eventDate < dateStr && eventEndDate > dateStr);
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }, [events, selectedDate]);

  const conflictCount = useMemo(() => dayEvents.filter(e => e.has_conflict).length, [dayEvents]);

  const goToPrevDay = () => setSelectedDate(d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
  const goToNextDay = () => setSelectedDate(d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
  const goToToday = () => setSelectedDate(new Date());

  const openNewEventForm = () => {
    setEditingEvent(null);
    setFormData({ title: '', startTime: '09:00', endTime: '10:00', location: '', description: '' });
    setShowEventForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      toast.error('Event title is required');
      return;
    }
    
    setIsSubmitting(true);
    try {
      const dateStr = selectedDate.toISOString().split('T')[0];
      const startDateTime = new Date(`${dateStr}T${formData.startTime}:00`);
      const endDateTime = new Date(`${dateStr}T${formData.endTime}:00`);
      
      if (endDateTime <= startDateTime) {
        endDateTime.setDate(endDateTime.getDate() + 1);
      }
      
      if (editingEvent) {
        toast.info('Editing events is not yet supported');
      } else if (onEventCreate) {
        await onEventCreate({
          title: formData.title,
          start_time: startDateTime.toISOString(),
          end_time: endDateTime.toISOString(),
          location: formData.location || undefined,
          description: formData.description || undefined,
        });
        toast.success('Event created');
      }
      
      setShowEventForm(false);
      setEditingEvent(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save event');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEvent = async () => {
    if (!editingEvent || !onEventDelete) return;
    setIsSubmitting(true);
    try {
      await onEventDelete(editingEvent.id);
      toast.success('Event deleted');
      setShowEventForm(false);
      setEditingEvent(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete event');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getEventPosition = (event: CalendarEvent, overlapIndex = 0, totalOverlaps = 1) => {
    const start = new Date(event.start_time);
    const end = new Date(event.end_time);
    const dateStr = selectedDate.toISOString().split('T')[0];
    
    let startMins = start.getHours() * 60 + start.getMinutes();
    let endMins = end.getHours() * 60 + end.getMinutes();
    
    const eventDateStr = start.toISOString().split('T')[0];
    const eventEndDateStr = end.toISOString().split('T')[0];
    
    if (eventDateStr < dateStr) startMins = 0;
    if (eventEndDateStr > dateStr) endMins = 24 * 60;
    
    const top = (startMins / 60) * HOUR_HEIGHT;
    const height = Math.max(((endMins - startMins) / 60) * HOUR_HEIGHT, 24);
    const width = totalOverlaps > 1 ? `${(100 / totalOverlaps) - 1}%` : 'calc(100% - 60px)';
    const left = totalOverlaps > 1 ? `calc(56px + ${(overlapIndex * 100) / totalOverlaps}%)` : '56px';
    
    return { top, height, width, left };
  };

  const getOverlappingEvents = useCallback(() => {
    const groups: CalendarEvent[][] = [];
    
    dayEvents.forEach((event) => {
      const eventStart = new Date(event.start_time).getTime();
      const eventEnd = new Date(event.end_time).getTime();
      
      let foundGroup = false;
      for (const group of groups) {
        const overlaps = group.some((existing) => {
          const existingStart = new Date(existing.start_time).getTime();
          const existingEnd = new Date(existing.end_time).getTime();
          return eventStart < existingEnd && eventEnd > existingStart;
        });
        
        if (overlaps) {
          group.push(event);
          foundGroup = true;
          break;
        }
      }
      
      if (!foundGroup) groups.push([event]);
    });
    
    return groups;
  }, [dayEvents]);

  const overlappingGroups = useMemo(() => getOverlappingEvents(), [getOverlappingEvents]);

  const currentTimePosition = useMemo(() => {
    if (!isToday) return null;
    const now = new Date();
    return ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT;
  }, [isToday]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[1100px] w-[92vw] h-[85vh] max-h-[800px] p-0 flex flex-col bg-background border-border/50 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-5 py-4 border-b border-border/50 bg-secondary/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Navigation */}
              <div className="flex items-center gap-0.5 bg-secondary/50 border border-border/30 rounded-lg p-0.5">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={goToPrevDay} 
                  className="h-8 w-8 p-0 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={goToToday} 
                  className="h-8 px-3 rounded-md text-xs font-medium hover:bg-secondary text-muted-foreground hover:text-foreground"
                >
                  Today
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={goToNextDay} 
                  className="h-8 w-8 p-0 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              
              <div>
                <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                  {selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  {isToday && (
                    <span className="text-[10px] bg-teal-500 text-white px-2 py-0.5 rounded-full font-medium">
                      Today
                    </span>
                  )}
                </DialogTitle>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-muted-foreground">
                    {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}
                  </span>
                  {conflictCount > 0 && (
                    <span className="text-xs text-amber-500 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {lastSyncDisplay !== 'Never synced' && (
                    <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {lastSyncDisplay}
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <Button 
              size="sm" 
              onClick={openNewEventForm} 
              className="gap-1.5 bg-teal-500 hover:bg-teal-600 text-white font-medium h-8 px-3 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
                New Event
              </Button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="flex-1 flex overflow-hidden">
          {/* Time Grid */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative eos-scrollbar">
            {!isConnected ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <div className="w-14 h-14 rounded-xl bg-sky-500/10 flex items-center justify-center mb-4">
                  <CalendarDays className="h-7 w-7 text-sky-500" />
                </div>
                <p className="text-base font-semibold text-foreground mb-1">Calendar Not Connected</p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Connect your Google Calendar to view and manage your events.
                </p>
              </div>
            ) : (
              <div className="relative" style={{ height: 24 * HOUR_HEIGHT }}>
                {/* Hour lines */}
                {HOURS.map(hour => (
                  <div 
                    key={hour} 
                    className="absolute w-full border-t border-border/30" 
                    style={{ top: hour * HOUR_HEIGHT }}
                  >
                    <span className="absolute left-3 -top-2 text-[10px] text-muted-foreground/50 font-medium w-10">
                      {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                    </span>
                  </div>
                ))}
                
                {/* Current time indicator */}
                {currentTimePosition !== null && (
                  <div className="absolute w-full z-20 pointer-events-none" style={{ top: currentTimePosition }}>
                    <div className="flex items-center">
                      <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                      <div className="flex-1 h-px bg-red-500" />
                    </div>
                  </div>
                )}
                
                {/* Events */}
                {overlappingGroups.map((group) => 
                  group.map((event, idx) => {
                    const pos = getEventPosition(event, idx, group.length);
                    return (
                      <button
                        key={event.id}
                        onClick={() => {
                          setEditingEvent(event);
                          setFormData({
                            title: event.title,
                            startTime: new Date(event.start_time).toTimeString().slice(0, 5),
                            endTime: new Date(event.end_time).toTimeString().slice(0, 5),
                            location: event.location || '',
                            description: event.description || '',
                          });
                          setShowEventForm(true);
                        }}
                        className={cn(
                          'absolute rounded-lg px-2.5 py-1.5 text-left text-xs overflow-hidden transition-all',
                          'hover:brightness-110 hover:z-30',
                          event.has_conflict
                            ? 'bg-amber-500/15 text-foreground border-l-2 border-l-amber-500'
                            : 'bg-teal-500/15 text-foreground border-l-2 border-l-teal-500'
                        )}
                        style={{ 
                          top: pos.top, 
                          height: pos.height, 
                          width: pos.width,
                          left: pos.left,
                        }}
                      >
                        <p className="font-medium truncate text-xs">{event.title}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {new Date(event.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          {event.location && ` · ${event.location.includes('http') ? 'Online' : event.location}`}
                        </p>
                        {event.has_conflict && (
                          <AlertTriangle className="absolute top-1.5 right-1.5 h-3 w-3 text-amber-500" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Event Form Sidebar */}
          {showEventForm && (
            <div className="w-80 border-l border-border/50 p-4 bg-secondary/30 overflow-y-auto eos-scrollbar-thin">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-sm text-foreground">
                  {editingEvent ? 'Edit Event' : 'New Event'}
                </h3>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setShowEventForm(false)} 
                  className="h-7 w-7 p-0 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="title" className="text-xs font-medium text-muted-foreground">Title</Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Event title"
                    className="mt-1.5 h-9 text-sm"
                    autoFocus
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Start
                    </Label>
                    <select
                      value={formData.startTime}
                      onChange={(e) => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                      className="mt-1.5 w-full h-9 px-3 rounded-md border border-border bg-background text-xs text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
                    >
                      {TIME_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> End
                    </Label>
                    <select
                      value={formData.endTime}
                      onChange={(e) => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                      className="mt-1.5 w-full h-9 px-3 rounded-md border border-border bg-background text-xs text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
                    >
                      {TIME_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="location" className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> Location
                  </Label>
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                    placeholder="Add location or link"
                    className="mt-1.5 h-9 text-sm"
                  />
                </div>
                
                <div>
                  <Label htmlFor="description" className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <FileText className="h-3 w-3" /> Description
                  </Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Add description"
                    className="mt-1.5 text-sm resize-none"
                    rows={3}
                  />
                </div>
                
                <div className="flex gap-2 pt-3 border-t border-border/50">
                  {editingEvent && onEventDelete && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleDeleteEvent}
                      disabled={isSubmitting}
                      className="gap-1 text-red-500 hover:text-red-600 hover:bg-red-500/10 h-8 text-xs"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </Button>
                  )}
                  <div className="flex-1" />
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setShowEventForm(false)}
                    className="h-8 text-xs text-muted-foreground"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    size="sm" 
                    disabled={isSubmitting} 
                    className="bg-teal-500 hover:bg-teal-600 text-white font-medium h-8 px-4 text-xs"
                  >
                    {isSubmitting ? 'Saving...' : editingEvent ? 'Update' : 'Create'}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
