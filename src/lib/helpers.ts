/**
 * EmergentOS - Helper Functions
 * 
 * Core helper functions from Section 16.
 */

import {
  WORK_DAY_START_HOUR,
  WORK_DAY_END_HOUR,
  MIN_FOCUS_BLOCK_HOURS,
  MAX_BACK_TO_BACK_GAP_MINUTES,
  MIN_BACK_TO_BACK_SEQUENCE,
} from './constants';

// ============================================================================
// Types
// ============================================================================

export interface CalendarEvent {
  event_id: string;
  title: string;
  description?: string | null;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  location?: string | null;
  attendees?: unknown[];
  organizer?: string | null;
  has_conflict: boolean;
  conflict_with: string[];
}

export interface FocusBlock {
  dateUTC: string;
  startTimeUTC: string;
  endTimeUTC: string;
  durationHours: number;
}

export interface BackToBackSequence {
  events: CalendarEvent[];
  totalDurationMinutes: number;
  severity: 'WARNING' | 'CRITICAL';
}

export interface ConflictInfo {
  eventA: { event_id: string; title: string; start_time: string; end_time: string };
  eventB: { event_id: string; title: string; start_time: string; end_time: string };
  overlapMinutes: number;
}

// ============================================================================
// Conflict Detection (Sweep Line Algorithm)
// ============================================================================

/**
 * Detect scheduling conflicts using O(n log n) sweep line algorithm
 */
export function detectConflicts<T extends { event_id: string; start_time: string; end_time: string }>(
  events: T[]
): (T & { has_conflict: boolean; conflict_with: string[] })[] {
  const points: Array<{ time: number; type: 'start' | 'end'; event: T }> = [];
  
  for (const event of events) {
    points.push({
      time: new Date(event.start_time).getTime(),
      type: 'start',
      event,
    });
    points.push({
      time: new Date(event.end_time).getTime(),
      type: 'end',
      event,
    });
  }
  
  // Sort: by time, then ends before starts (to handle exact overlaps)
  points.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.type === 'end' ? -1 : 1;
  });
  
  const active = new Set<T>();
  const conflicts = new Map<string, Set<string>>();
  
  for (const point of points) {
    if (point.type === 'start') {
      // Mark conflicts with all currently active events
      for (const activeEvent of active) {
        if (!conflicts.has(point.event.event_id)) {
          conflicts.set(point.event.event_id, new Set());
        }
        if (!conflicts.has(activeEvent.event_id)) {
          conflicts.set(activeEvent.event_id, new Set());
        }
        conflicts.get(point.event.event_id)!.add(activeEvent.event_id);
        conflicts.get(activeEvent.event_id)!.add(point.event.event_id);
      }
      active.add(point.event);
    } else {
      active.delete(point.event);
    }
  }
  
  // Update events with conflict info
  return events.map((event) => ({
    ...event,
    has_conflict: conflicts.has(event.event_id),
    conflict_with: conflicts.has(event.event_id)
      ? Array.from(conflicts.get(event.event_id)!)
      : [],
  }));
}

/**
 * Get detailed conflict information for prompts
 */
export function getConflictDetails(events: CalendarEvent[]): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  const seen = new Set<string>();
  
  for (const event of events) {
    if (!event.has_conflict) continue;
    
    for (const conflictId of event.conflict_with) {
      const key = [event.event_id, conflictId].sort().join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      
      const otherEvent = events.find((e) => e.event_id === conflictId);
      if (!otherEvent) continue;
      
      const start1 = new Date(event.start_time).getTime();
      const end1 = new Date(event.end_time).getTime();
      const start2 = new Date(otherEvent.start_time).getTime();
      const end2 = new Date(otherEvent.end_time).getTime();
      
      const overlapStart = Math.max(start1, start2);
      const overlapEnd = Math.min(end1, end2);
      const overlapMinutes = Math.max(0, (overlapEnd - overlapStart) / 60000);
      
      conflicts.push({
        eventA: {
          event_id: event.event_id,
          title: event.title,
          start_time: event.start_time,
          end_time: event.end_time,
        },
        eventB: {
          event_id: otherEvent.event_id,
          title: otherEvent.title,
          start_time: otherEvent.start_time,
          end_time: otherEvent.end_time,
        },
        overlapMinutes,
      });
    }
  }
  
  return conflicts;
}

// ============================================================================
// Focus Block Detection
// ============================================================================

/**
 * Identify available focus blocks (2+ hours) within work days
 */
export function identifyFocusBlocks(
  events: CalendarEvent[],
  now: Date = new Date()
): FocusBlock[] {
  const focusBlocks: FocusBlock[] = [];
  
  for (let d = 0; d < 7; d++) {
    // Calculate day boundaries in UTC
    const dayStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + d,
      WORK_DAY_START_HOUR, 0, 0, 0
    ));
    
    const dayEnd = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + d,
      WORK_DAY_END_HOUR, 0, 0, 0
    ));
    
    const dateUTC = dayStart.toISOString().split('T')[0];
    
    // Filter events that OVERLAP with work day
    const dayEvents = events
      .filter((e) => {
        const start = new Date(e.start_time);
        const end = new Date(e.end_time);
        return start < dayEnd && end > dayStart;
      })
      .sort((a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      );
    
    // Find gaps between meetings
    let currentTime = dayStart;
    
    for (const event of dayEvents) {
      const eventStart = new Date(event.start_time);
      const eventEnd = new Date(event.end_time);
      
      // Clamp event times to work day boundaries
      const effectiveStart = eventStart < dayStart ? dayStart : eventStart;
      const effectiveEnd = eventEnd > dayEnd ? dayEnd : eventEnd;
      
      // Calculate gap before this event
      const gapMs = effectiveStart.getTime() - currentTime.getTime();
      const gapHours = gapMs / (1000 * 60 * 60);
      
      if (gapHours >= MIN_FOCUS_BLOCK_HOURS) {
        focusBlocks.push({
          dateUTC,
          startTimeUTC: currentTime.toISOString(),
          endTimeUTC: effectiveStart.toISOString(),
          durationHours: Math.round(gapHours * 10) / 10,
        });
      }
      
      // Move current time to end of this event
      if (effectiveEnd > currentTime) {
        currentTime = effectiveEnd;
      }
    }
    
    // Check for focus time after last meeting
    if (currentTime < dayEnd) {
      const remainingMs = dayEnd.getTime() - currentTime.getTime();
      const remainingHours = remainingMs / (1000 * 60 * 60);
      
      if (remainingHours >= MIN_FOCUS_BLOCK_HOURS) {
        focusBlocks.push({
          dateUTC,
          startTimeUTC: currentTime.toISOString(),
          endTimeUTC: dayEnd.toISOString(),
          durationHours: Math.round(remainingHours * 10) / 10,
        });
      }
    }
  }
  
  return focusBlocks;
}

// ============================================================================
// Back-to-Back Meeting Detection
// ============================================================================

/**
 * Identify sequences of back-to-back meetings
 */
export function identifyBackToBackMeetings(
  events: CalendarEvent[]
): BackToBackSequence[] {
  const sequences: BackToBackSequence[] = [];
  
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );
  
  let currentSequence: CalendarEvent[] = [];
  
  for (const event of sortedEvents) {
    if (currentSequence.length === 0) {
      currentSequence.push(event);
      continue;
    }
    
    const lastEvent = currentSequence[currentSequence.length - 1];
    const lastEnd = new Date(lastEvent.end_time);
    const currentStart = new Date(event.start_time);
    const gapMinutes = (currentStart.getTime() - lastEnd.getTime()) / (1000 * 60);
    
    if (gapMinutes <= MAX_BACK_TO_BACK_GAP_MINUTES) {
      currentSequence.push(event);
    } else {
      // End current sequence
      if (currentSequence.length >= MIN_BACK_TO_BACK_SEQUENCE) {
        sequences.push(buildSequence(currentSequence));
      }
      currentSequence = [event];
    }
  }
  
  // Don't forget the last sequence
  if (currentSequence.length >= MIN_BACK_TO_BACK_SEQUENCE) {
    sequences.push(buildSequence(currentSequence));
  }
  
  return sequences;
}

function buildSequence(events: CalendarEvent[]): BackToBackSequence {
  const firstStart = new Date(events[0].start_time);
  const lastEnd = new Date(events[events.length - 1].end_time);
  const totalDurationMinutes = (lastEnd.getTime() - firstStart.getTime()) / (1000 * 60);
  
  return {
    events,
    totalDurationMinutes,
    severity: events.length >= 4 ? 'CRITICAL' : 'WARNING',
  };
}

// ============================================================================
// HTML Utilities
// ============================================================================

/**
 * Strip HTML tags and decode entities
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')           // Remove all HTML tags
    .replace(/&nbsp;/g, ' ')           // Non-breaking space
    .replace(/&amp;/g, '&')            // Ampersand
    .replace(/&lt;/g, '<')             // Less than
    .replace(/&gt;/g, '>')             // Greater than
    .replace(/&quot;/g, '"')           // Quote
    .replace(/&#39;/g, "'")            // Apostrophe
    .replace(/\s+/g, ' ')              // Collapse whitespace
    .trim();
}

/**
 * Decode HTML entities
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// ============================================================================
// Content Hash
// ============================================================================

/**
 * Calculate SHA-256 hash for content deduplication
 */
export async function calculateContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
