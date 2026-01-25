/**
 * EmergentOS - Daily Briefing & Insights Cron
 * 
 * Generates morning briefings AND calendar insights for all users at 6 AM UTC.
 * Per Section 10.2.
 */

import { inngest } from '../inngest';
import { supabase } from '../supabase';
import { getCurrentUTCDate, daysAgoUTC, daysFromNowUTC, startOfDayUTC, endOfDayUTC } from '../time';
import { callGeminiJSON, isGeminiConfigured } from '../llm/gemini';
import { buildBriefingPrompt, buildCalendarAnalysisPrompt } from '../llm/prompts';
import { MORNING_BRIEFING_CRON, CALENDAR_ANALYSIS_PAST_DAYS, CALENDAR_ANALYSIS_FUTURE_DAYS } from '../constants';
import { getConflictDetails, identifyFocusBlocks, type CalendarEvent } from '../helpers';

// ============================================================================
// Types
// ============================================================================

interface BriefingResult {
  userId: string;
  success: boolean;
  briefingId?: string;
  error?: string;
}

interface CalendarInsightsResult {
  userId: string;
  success: boolean;
  insightsGenerated?: boolean;
  error?: string;
}

interface DailyGenerationResult {
  userId: string;
  briefingSuccess: boolean;
  briefingId?: string;
  briefingError?: string;
  insightsSuccess: boolean;
  insightsGenerated?: boolean;
  insightsError?: string;
}

// ============================================================================
// Morning Briefing & Insights Cron
// ============================================================================

export const generateDailyBriefingCron = inngest.createFunction(
  {
    id: 'generate-daily-briefing-cron',
    name: 'Daily Morning Briefing & Insights',
  },
  { cron: MORNING_BRIEFING_CRON },  // 6 AM UTC
  async ({ step }) => {
    console.log('[Daily Cron] Starting daily briefing & insights generation');

    // Get all users with at least one connected source, including provider info
    const usersWithProviders = await step.run('get-active-users', async () => {
      const { data } = await supabase
        .from('connections')
        .select('user_id, provider')
        .eq('status', 'connected');

      // Group by user_id and track which providers they have
      const userProviders = new Map<string, Set<string>>();
      for (const conn of data || []) {
        if (!userProviders.has(conn.user_id)) {
          userProviders.set(conn.user_id, new Set());
        }
        userProviders.get(conn.user_id)!.add(conn.provider);
      }

      return Array.from(userProviders.entries()).map(([userId, providers]) => ({
        userId,
        hasCalendar: providers.has('calendar'),
      }));
    });

    console.log(`[Daily Cron] Found ${usersWithProviders.length} users with connections`);

    // Generate briefing AND insights for each user
    const results: DailyGenerationResult[] = [];
    for (const { userId, hasCalendar } of usersWithProviders) {
      const result = await step.run(`daily-gen-${userId}`, async () => {
        const genResult: DailyGenerationResult = {
          userId,
          briefingSuccess: false,
          insightsSuccess: false,
        };

        // 1. Generate Briefing
        try {
          const briefingResult = await generateBriefingForUser({ userId });
          genResult.briefingSuccess = briefingResult.success;
          genResult.briefingId = briefingResult.briefingId;
          genResult.briefingError = briefingResult.error;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[Daily Cron] Briefing failed for ${userId}:`, error);
          genResult.briefingError = errorMessage;
        }

        // 2. Generate Calendar Insights (only if calendar connected)
        if (hasCalendar) {
          try {
            const insightsResult = await generateCalendarInsightsForUser({ userId });
            genResult.insightsSuccess = insightsResult.success;
            genResult.insightsGenerated = insightsResult.insightsGenerated;
            genResult.insightsError = insightsResult.error;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[Daily Cron] Insights failed for ${userId}:`, error);
            genResult.insightsError = errorMessage;
          }
        } else {
          // No calendar, mark as success (no action needed)
          genResult.insightsSuccess = true;
          genResult.insightsGenerated = false;
        }

        return genResult;
      });
      results.push(result);
    }

    const briefingSuccessful = results.filter((r) => r.briefingSuccess).length;
    const briefingFailed = results.filter((r) => !r.briefingSuccess).length;
    const insightsSuccessful = results.filter((r) => r.insightsSuccess).length;
    const insightsFailed = results.filter((r) => !r.insightsSuccess).length;
    const insightsGenerated = results.filter((r) => r.insightsGenerated).length;

    console.log(`[Daily Cron] Complete - Briefings: ${briefingSuccessful} success, ${briefingFailed} failed`);
    console.log(`[Daily Cron] Complete - Insights: ${insightsSuccessful} success, ${insightsFailed} failed, ${insightsGenerated} generated`);

    return {
      usersProcessed: usersWithProviders.length,
      briefings: {
        successful: briefingSuccessful,
        failed: briefingFailed,
      },
      insights: {
        successful: insightsSuccessful,
        failed: insightsFailed,
        generated: insightsGenerated,
      },
      results,
    };
  }
);

// ============================================================================
// Briefing Generation (also used by API)
// ============================================================================

export async function generateBriefingForUser(
  { userId }: { userId: string }
): Promise<BriefingResult> {
  console.log(`[Briefing] Generating for user ${userId}`);

  // 1. Get user's connected sources
  const { data: connections } = await supabase
    .from('connections')
    .select('provider, status')
    .eq('user_id', userId);

  const connectedSources = {
    gmail: connections?.some((c) => c.provider === 'gmail' && c.status === 'connected') || false,
    calendar: connections?.some((c) => c.provider === 'calendar' && c.status === 'connected') || false,
    drive: connections?.some((c) => c.provider === 'drive' && c.status === 'connected') || false,
  };

  // 2. If no sources connected, delete today's briefing and return
  if (!connectedSources.gmail && !connectedSources.calendar && !connectedSources.drive) {
    const todayUTC = getCurrentUTCDate();
    await supabase
      .from('briefings')
      .delete()
      .eq('user_id', userId)
      .eq('briefing_date', todayUTC);

    console.log(`[Briefing] No connected sources for ${userId}, deleted today's briefing`);
    return { userId, success: true };
  }

  // 3. Check if Gemini is configured
  if (!isGeminiConfigured()) {
    console.warn(`[Briefing] GEMINI_API_KEY not configured, skipping for ${userId}`);
    return { userId, success: false, error: 'GEMINI_API_KEY not configured' };
  }

  // 4. Fetch data from connected sources
  const now = new Date();
  const todayStartUTC = startOfDayUTC(now);
  const tomorrowEndUTC = endOfDayUTC(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const yesterdayStartUTC = daysAgoUTC(1);

  // Emails from last 24 hours
  let emails: Array<{
    sender: string;
    subject: string;
    snippet: string | null;
    received_at: string;
  }> = [];
  if (connectedSources.gmail) {
    const { data } = await supabase
      .from('emails')
      .select('sender, subject, snippet, received_at')
      .eq('user_id', userId)
      .gte('received_at', yesterdayStartUTC.toISOString())
      .order('received_at', { ascending: false });
    emails = data || [];
  }

  // Calendar events for today and tomorrow
  let events: Array<{
    event_id: string;
    title: string;
    description: string | null;
    start_time: string;
    end_time: string;
    is_all_day: boolean;
    location: string | null;
    attendees: unknown[];
    organizer: string | null;
    has_conflict: boolean;
    conflict_with: string[];
  }> = [];
  if (connectedSources.calendar) {
    const { data } = await supabase
      .from('calendar_events')
      .select('event_id, title, description, start_time, end_time, is_all_day, location, attendees, organizer, has_conflict, conflict_with')
      .eq('user_id', userId)
      .lte('start_time', tomorrowEndUTC.toISOString())
      .gte('end_time', todayStartUTC.toISOString())
      .order('start_time', { ascending: true });
    events = data || [];
  }

  // Recent documents
  let documents: Array<{
    name: string;
    mime_type: string;
    modified_at: string | null;
  }> = [];
  if (connectedSources.drive) {
    const { data } = await supabase
      .from('drive_documents')
      .select('name, mime_type, modified_at')
      .eq('user_id', userId)
      .gte('modified_at', yesterdayStartUTC.toISOString())
      .order('modified_at', { ascending: false });
    documents = data || [];
  }

  // 5. Build prompt and call Gemini
  const prompt = buildBriefingPrompt(emails, events, documents, connectedSources);

  let content: Record<string, unknown>;
  try {
    const responseText = await callGeminiJSON(prompt);
    content = JSON.parse(responseText);
  } catch (error) {
    console.error(`[Briefing] Gemini error for ${userId}:`, error);
    return { userId, success: false, error: error instanceof Error ? error.message : 'LLM error' };
  }

  // 6. UPSERT into briefings table
  const todayUTC = getCurrentUTCDate();
  const { data: briefing, error } = await supabase
    .from('briefings')
    .upsert({
      user_id: userId,
      briefing_date: todayUTC,
      content,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,briefing_date' })
    .select('id')
    .single();

  if (error) {
    console.error(`[Briefing] Database error for ${userId}:`, error);
    return { userId, success: false, error: error.message };
  }

  console.log(`[Briefing] Generated for ${userId}, briefingId: ${briefing.id}`);
  return { userId, success: true, briefingId: briefing.id };
}

// ============================================================================
// Calendar Insights Generation (also used by API)
// ============================================================================

export async function generateCalendarInsightsForUser(
  { userId }: { userId: string }
): Promise<CalendarInsightsResult> {
  console.log(`[Insights] Generating calendar insights for user ${userId}`);

  // 1. Check if user has calendar connection
  const { data: connection } = await supabase
    .from('connections')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', 'calendar')
    .eq('status', 'connected')
    .single();

  if (!connection) {
    console.log(`[Insights] No calendar connection for ${userId}, skipping`);
    return { userId, success: true, insightsGenerated: false };
  }

  // 2. Check if Gemini is configured
  if (!isGeminiConfigured()) {
    console.warn(`[Insights] GEMINI_API_KEY not configured, skipping for ${userId}`);
    return { userId, success: false, error: 'GEMINI_API_KEY not configured' };
  }

  // 3. Fetch events in analysis window (7 days past, 14 days future)
  const pastDate = daysAgoUTC(CALENDAR_ANALYSIS_PAST_DAYS).toISOString();
  const futureDate = daysFromNowUTC(CALENDAR_ANALYSIS_FUTURE_DAYS).toISOString();

  const { data: events } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('user_id', userId)
    .gte('start_time', pastDate)
    .lte('start_time', futureDate)
    .order('start_time', { ascending: true });

  if (!events || events.length === 0) {
    console.log(`[Insights] No calendar events for ${userId}, skipping analysis`);
    return { userId, success: true, insightsGenerated: false };
  }

  // 4. Map to CalendarEvent format
  const calendarEvents: CalendarEvent[] = events.map((e) => ({
    event_id: e.event_id,
    title: e.title,
    description: e.description,
    start_time: e.start_time,
    end_time: e.end_time,
    is_all_day: e.is_all_day,
    location: e.location,
    attendees: e.attendees as unknown[],
    organizer: e.organizer,
    has_conflict: e.has_conflict,
    conflict_with: e.conflict_with || [],
  }));

  // 5. Get conflict details and focus blocks
  const conflicts = getConflictDetails(calendarEvents);
  const focusBlocks = identifyFocusBlocks(calendarEvents, new Date());

  // 6. Build prompt and call Gemini
  const prompt = buildCalendarAnalysisPrompt(calendarEvents, conflicts, focusBlocks);

  let content: Record<string, unknown>;
  try {
    const responseText = await callGeminiJSON(prompt);
    content = JSON.parse(responseText);
  } catch (error) {
    console.error(`[Insights] Gemini error for ${userId}:`, error);
    return { userId, success: false, error: error instanceof Error ? error.message : 'LLM error' };
  }

  // 7. Extract metrics from response
  const metrics = (content.metrics || {}) as Record<string, number>;
  const conflictsCount = metrics.conflictCount ?? conflicts.length;
  const focusTimeHours = metrics.focusHoursAvailable ?? focusBlocks.reduce((sum, b) => sum + b.durationHours, 0);
  const meetingHours = metrics.meetingHoursTotal ?? 0;

  // 8. UPSERT into calendar_insights table
  const { error: upsertError } = await supabase
    .from('calendar_insights')
    .upsert({
      user_id: userId,
      content,
      conflicts_count: conflictsCount,
      focus_time_hours: focusTimeHours,
      meeting_hours: meetingHours,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (upsertError) {
    console.error(`[Insights] Database error for ${userId}:`, upsertError);
    return { userId, success: false, error: upsertError.message };
  }

  console.log(`[Insights] Generated for ${userId}, conflicts: ${conflictsCount}, focus: ${focusTimeHours}h, meetings: ${meetingHours}h`);
  return { userId, success: true, insightsGenerated: true };
}
