import { supabaseAdmin } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { scanContent } from '@/lib/nightfall';
import { upsertPiiVaultTokens } from '@/lib/pii-vault';
import { geminiGenerateText, safeJsonParse } from '@/lib/gemini';

type EventRow = {
  event_id: string;
  title: string;
  description?: string | null;
  start_time: string;
  end_time: string;
  location?: string | null;
  status?: string | null;
  has_conflict?: boolean | null;
  attendees?: unknown[] | null;
  is_all_day?: boolean | null;
};

type ConflictInfo = {
  event_id: string;
  overlap_ids: string[];
  type: 'hard_overlap' | 'back_to_back' | 'insufficient_buffer' | 'travel_conflict';
  severity: 'critical' | 'high' | 'medium' | 'low';
  details: string;
};

function isoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function requireDlpReady() {
  if (!process.env.NIGHTFALL_API_KEY) throw new Error('Missing NIGHTFALL_API_KEY (DLP gate required)');
  const keyB64 = process.env.PII_VAULT_KEY_BASE64;
  if (!keyB64) throw new Error('Missing PII_VAULT_KEY_BASE64 (PII vault key required)');
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('PII_VAULT_KEY_BASE64 must decode to 32 bytes (AES-256 key)');
}

/**
 * Advanced conflict detection with multiple conflict types:
 * 1. Hard overlaps - events that directly overlap in time
 * 2. Back-to-back meetings - no break between consecutive meetings
 * 3. Insufficient buffer - less than 15 min between meetings
 * 4. Travel conflicts - physical locations require travel time
 */
export function findCalendarConflicts(events: EventRow[]): {
  conflicts: Record<string, string[]>;
  conflictDetails: ConflictInfo[];
} {
  const filtered = events
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({
      ...e,
      start: new Date(e.start_time).getTime(),
      end: new Date(e.end_time).getTime(),
      isOnline: !!(e.location && (
        e.location.toLowerCase().includes('http') ||
        e.location.toLowerCase().includes('zoom') ||
        e.location.toLowerCase().includes('meet.google') ||
        e.location.toLowerCase().includes('teams')
      )),
      isPhysical: !!(e.location && 
        !e.location.toLowerCase().includes('http') &&
        !e.location.toLowerCase().includes('zoom') &&
        !e.location.toLowerCase().includes('meet') &&
        !e.location.toLowerCase().includes('teams') &&
        e.location.trim().length > 0
      ),
    }))
    .filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > e.start)
    .sort((a, b) => a.start - b.start);

  const conflicts: Record<string, string[]> = {};
  const conflictDetails: ConflictInfo[] = [];
  const BUFFER_MIN = 15 * 60 * 1000; // 15 minutes
  const TRAVEL_MIN = 30 * 60 * 1000; // 30 minutes for physical location changes

  for (let i = 0; i < filtered.length; i++) {
    const eventA = filtered[i];
    
    for (let j = i + 1; j < filtered.length; j++) {
      const eventB = filtered[j];
      
      // Stop checking if eventB starts more than 1 hour after eventA ends
      if (eventB.start > eventA.end + 60 * 60 * 1000) break;

      // 1. HARD OVERLAP: eventB starts before eventA ends
      if (eventB.start < eventA.end) {
        conflicts[eventA.event_id] = [...(conflicts[eventA.event_id] || []), eventB.event_id];
        conflicts[eventB.event_id] = [...(conflicts[eventB.event_id] || []), eventA.event_id];
        
        const overlapMinutes = Math.round((eventA.end - eventB.start) / 60000);
        conflictDetails.push({
          event_id: eventA.event_id,
          overlap_ids: [eventB.event_id],
          type: 'hard_overlap',
          severity: overlapMinutes > 30 ? 'critical' : 'high',
          details: `"${eventA.title}" overlaps with "${eventB.title}" by ${overlapMinutes} minutes`,
        });
      }
      // 2. BACK-TO-BACK: No gap between meetings
      else if (eventB.start === eventA.end) {
        conflictDetails.push({
          event_id: eventA.event_id,
          overlap_ids: [eventB.event_id],
          type: 'back_to_back',
          severity: 'medium',
          details: `"${eventA.title}" ends exactly when "${eventB.title}" starts - no recovery time`,
        });
      }
      // 3. INSUFFICIENT BUFFER: Less than 15 min gap
      else if (eventB.start - eventA.end < BUFFER_MIN) {
        const gapMinutes = Math.round((eventB.start - eventA.end) / 60000);
        conflictDetails.push({
          event_id: eventA.event_id,
          overlap_ids: [eventB.event_id],
          type: 'insufficient_buffer',
          severity: 'low',
          details: `Only ${gapMinutes}min between "${eventA.title}" and "${eventB.title}" - recommend 15min buffer`,
        });
      }
      // 4. TRAVEL CONFLICT: Physical locations need travel time
      else if (eventA.isPhysical && eventB.isPhysical && eventB.start - eventA.end < TRAVEL_MIN) {
        if (eventA.location !== eventB.location) {
          const gapMinutes = Math.round((eventB.start - eventA.end) / 60000);
          conflictDetails.push({
            event_id: eventA.event_id,
            overlap_ids: [eventB.event_id],
            type: 'travel_conflict',
            severity: 'high',
            details: `Only ${gapMinutes}min to travel from "${eventA.location}" to "${eventB.location}"`,
          });
        }
      }
    }
  }

  return { conflicts, conflictDetails };
}

/**
 * Calculate meeting statistics for analysis
 */
function calculateMeetingStats(events: EventRow[]) {
  const activeEvents = events.filter((e) => e.status !== 'cancelled');
  const totalMinutes = activeEvents.reduce((sum, e) => {
    const start = new Date(e.start_time).getTime();
    const end = new Date(e.end_time).getTime();
    return sum + (end - start) / 60000;
  }, 0);

  const byDay: Record<string, number> = {};
  activeEvents.forEach((e) => {
    const day = new Date(e.start_time).toLocaleDateString('en-US', { weekday: 'short' });
    const duration = (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000;
    byDay[day] = (byDay[day] || 0) + duration;
  });

  const longMeetings = activeEvents.filter((e) => {
    const duration = (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000;
    return duration > 60;
  });

  const earlyMeetings = activeEvents.filter((e) => {
    const hour = new Date(e.start_time).getHours();
    return hour < 9;
  });

  const lateMeetings = activeEvents.filter((e) => {
    const hour = new Date(e.end_time).getHours();
    return hour > 18;
  });

  const oneOnOnes = activeEvents.filter((e) => {
    const attendeeCount = Array.isArray(e.attendees) ? e.attendees.length : 0;
    return attendeeCount === 1 || attendeeCount === 2;
  });

  const largeGroupMeetings = activeEvents.filter((e) => {
    const attendeeCount = Array.isArray(e.attendees) ? e.attendees.length : 0;
    return attendeeCount > 5;
  });

  return {
    totalEvents: activeEvents.length,
    totalHours: Math.round(totalMinutes / 60 * 10) / 10,
    avgMeetingLength: Math.round(totalMinutes / Math.max(activeEvents.length, 1)),
    meetingsByDay: byDay,
    longMeetingsCount: longMeetings.length,
    earlyMeetingsCount: earlyMeetings.length,
    lateMeetingsCount: lateMeetings.length,
    oneOnOnesCount: oneOnOnes.length,
    largeGroupMeetingsCount: largeGroupMeetings.length,
    heaviestDay: Object.entries(byDay).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A',
  };
}

function buildCalendarAnalysisPrompt(args: {
  date: string;
  windowStart: string;
  windowEnd: string;
  events: EventRow[];
  conflictDetails: ConflictInfo[];
  stats: ReturnType<typeof calculateMeetingStats>;
}): string {
  const { date, windowStart, windowEnd, events, conflictDetails, stats } = args;
  
  const eventLines = events
    .slice()
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .map((e) => {
      const start = new Date(e.start_time);
      const end = new Date(e.end_time);
      const duration = Math.round((end.getTime() - start.getTime()) / 60000);
      const dayName = start.toLocaleDateString('en-US', { weekday: 'short' });
      const startStr = start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      const endStr = end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      const attendees = Array.isArray(e.attendees) ? e.attendees.length : 0;
      const loc = e.location ? ` [${e.location}]` : '';
      const status = e.status !== 'confirmed' ? ` (${e.status})` : '';
      return `• ${dayName} ${startStr}-${endStr} (${duration}min): "${e.title}"${loc}${status} [${attendees} attendees]`;
    })
    .join('\n') || '(No events scheduled)';

  const conflictLines = conflictDetails.length > 0
    ? conflictDetails.map((c) => `• [${c.severity.toUpperCase()}] ${c.type}: ${c.details}`).join('\n')
    : '(No conflicts detected)';

  return `You are an elite executive time strategist advising a C-Suite leader (CEO/CTO/CFO level).
Your client manages multiple billion-dollar initiatives and their time is their most valuable asset.
Think like you're advising Elon Musk, Jeff Bezos, or Tim Cook.

═══════════════════════════════════════════════════════
ANALYSIS PERIOD
═══════════════════════════════════════════════════════
Current Date (UTC): ${date}
Analysis Window: ${windowStart.slice(0, 16)} to ${windowEnd.slice(0, 16)}

═══════════════════════════════════════════════════════
CALENDAR STATISTICS
═══════════════════════════════════════════════════════
• Total Events: ${stats.totalEvents}
• Total Scheduled Hours: ${stats.totalHours}h
• Average Meeting Length: ${stats.avgMeetingLength} minutes
• Meetings >1 hour: ${stats.longMeetingsCount}
• Before 9 AM: ${stats.earlyMeetingsCount}
• After 6 PM: ${stats.lateMeetingsCount}
• 1:1 Meetings: ${stats.oneOnOnesCount}
• Large Group (>5): ${stats.largeGroupMeetingsCount}
• Heaviest Day: ${stats.heaviestDay}

═══════════════════════════════════════════════════════
DETECTED ISSUES
═══════════════════════════════════════════════════════
${conflictLines}

═══════════════════════════════════════════════════════
SCHEDULED EVENTS
═══════════════════════════════════════════════════════
${eventLines}

═══════════════════════════════════════════════════════
YOUR MISSION
═══════════════════════════════════════════════════════
Analyze this executive's calendar with extreme rigor and provide:

1. **CONFLICT ANALYSIS**: Deep analysis of scheduling conflicts and their business impact.
   - Which conflicts are truly critical vs. manageable?
   - What's the opportunity cost of each conflict?

2. **TIME SOVEREIGNTY ASSESSMENT**: 
   - Is this calendar optimized for peak performance?
   - Are there sufficient deep work blocks?
   - Is meeting load sustainable for high-stakes decision-making?

3. **STRATEGIC RECOMMENDATIONS** (5-7 specific, actionable items):
   Focus on:
   - Delegation opportunities (what can be delegated to direct reports?)
   - Meeting consolidation (can meetings be batched or combined?)
   - Recovery time (are there buffers for strategic thinking?)
   - Energy management (is the schedule aligned with energy cycles?)
   - Context switching cost (how many major context switches?)
   - Meeting hygiene (can meetings be shortened or made async?)

Think like a strategic advisor who understands:
- Every hour in meetings is an hour NOT spent on strategic thinking
- Back-to-back meetings degrade decision quality
- Senior leaders need whitespace for unexpected high-priority items
- The goal is IMPACT, not activity

═══════════════════════════════════════════════════════
OUTPUT FORMAT (JSON ONLY)
═══════════════════════════════════════════════════════
{
  "conflicts_summary": "2-3 sentence executive summary of scheduling issues and their business impact",
  "time_sovereignty_score": {
    "score": 1-10,
    "assessment": "Brief assessment of overall calendar health"
  },
  "critical_issues": [
    {
      "issue": "Specific issue description",
      "impact": "Business impact if not addressed",
      "urgency": "immediate|this_week|ongoing"
    }
  ],
  "suggestions": [
    {
      "title": "Clear, actionable title",
      "category": "delegation|consolidation|buffer|energy|async|hygiene",
      "rationale": "Why this matters for a C-Suite leader",
      "action": "Specific, concrete action to take",
      "expected_impact": "Expected benefit from implementing"
    }
  ],
  "quick_wins": ["List of 2-3 immediate actions that can be done today"]
}`;
}

export async function runCalendarAnalysisForUser(args: { userId: string }) {
  requireDlpReady();
  const { userId } = args;

  const now = new Date();
  const windowStart = now.toISOString();
  const windowEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const analysisDate = isoDateUTC(now);

  const supa = supabaseAdmin as unknown as SupabaseClient;

  const { data: events, error } = await supa
    .from('calendar_events')
    .select('event_id,title,description,start_time,end_time,location,status,has_conflict,attendees,is_all_day')
    .eq('user_id', userId)
    .gte('start_time', windowStart)
    .lte('start_time', windowEnd)
    .order('start_time', { ascending: true })
    .limit(500);
  if (error) throw error;

  const rows = (events || []) as unknown as EventRow[];
  const { conflicts, conflictDetails } = findCalendarConflicts(rows);
  const stats = calculateMeetingStats(rows);

  // Update conflict flags (also clears old conflicts in the window)
  for (const e of rows) {
    const overlapIds = conflicts[e.event_id] || [];
    await supa
      .from('calendar_events')
      .update({
        has_conflict: overlapIds.length > 0,
        conflict_with: overlapIds,
        updated_at: new Date().toISOString(),
      } as unknown as never)
      .eq('user_id', userId)
      .eq('event_id', e.event_id);
  }

  const prompt = buildCalendarAnalysisPrompt({
    date: analysisDate,
    windowStart,
    windowEnd,
    events: rows,
    conflictDetails,
    stats,
  });

  const scanned = await scanContent(prompt);
  await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });

  const suggestionsRaw = await geminiGenerateText(scanned.redacted);
  // Normalize to clean JSON string if possible (avoid ```json fences in storage)
  const parsed = safeJsonParse<unknown>(suggestionsRaw);
  const suggestions = parsed ? JSON.stringify(parsed, null, 2) : suggestionsRaw;
  
  // Count unique events with hard overlaps for conflictsCount
  const hardOverlapEventIds = new Set<string>();
  conflictDetails
    .filter((c) => c.type === 'hard_overlap')
    .forEach((c) => {
      hardOverlapEventIds.add(c.event_id);
      c.overlap_ids.forEach((id) => hardOverlapEventIds.add(id));
    });
  const conflictsCount = hardOverlapEventIds.size;

  const conflictsJson = conflictDetails.map((c) => ({
    event_id: c.event_id,
    overlap_ids: c.overlap_ids,
    type: c.type,
    severity: c.severity,
    details: c.details,
  }));

  const { error: upsertError } = await supa.from('calendar_insights').upsert(
    {
      user_id: userId,
      analysis_date: analysisDate,
      window_start: windowStart,
      window_end: windowEnd,
      conflicts: conflictsJson,
      conflicts_count: conflictsCount,
      suggestions,
      generated_at: new Date().toISOString(),
    } as unknown as never,
    { onConflict: 'user_id,analysis_date' }
  );
  if (upsertError) throw upsertError;

  return { success: true, userId, analysisDate, conflictsCount, totalIssues: conflictDetails.length };
}
