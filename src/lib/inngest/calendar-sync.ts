/**
 * EmergentOS - Calendar Sync Inngest Function
 * 
 * Implements processCalendarSync per Section 7.2.
 */

import { inngest } from '../inngest';
import { supabase } from '../supabase';
import { nango, PROVIDER_CONFIG_KEYS } from '../nango';
import { daysAgoUTC, daysFromNowUTC, startOfDayUTC } from '../time';
import { stripHtml, detectConflicts, identifyFocusBlocks, getConflictDetails } from '../helpers';
import { classifyError, formatErrorMessage } from '../errors';
import { generateAndStoreEmbeddings, prepareCalendarEmbeddings } from '../embeddings';
import { callGeminiJSON, isGeminiConfigured } from '../llm/gemini';
import { buildCalendarAnalysisPrompt } from '../llm/prompts';
import {
  CALENDAR_PAST_DAYS,
  CALENDAR_FUTURE_DAYS,
  CALENDAR_ANALYSIS_PAST_DAYS,
  CALENDAR_ANALYSIS_FUTURE_DAYS,
  IMMINENT_REANALYSIS_WINDOW_START_MINUTES,
  IMMINENT_REANALYSIS_WINDOW_END_MINUTES,
} from '../constants';

// ============================================================================
// Types
// ============================================================================

interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
    organizer?: boolean;
    self?: boolean;
  }>;
  organizer?: { email?: string };
  status: 'confirmed' | 'cancelled' | 'tentative';
}

interface ParsedEvent {
  event_id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  location: string | null;
  attendees: unknown[];
  organizer: string | null;
  status: string;
}

interface CalendarChangeDetection {
  dataChanged: boolean;
  timeChanged: boolean;
  reason: string;
}

// ============================================================================
// Calendar Sync Function
// ============================================================================

export const processCalendarSync = inngest.createFunction(
  {
    id: 'process-calendar-sync',
    name: 'Process Calendar Sync',
    retries: 3,
  },
  { event: 'calendar/sync.requested' },
  async ({ event, step }) => {
    const { userId, connectionId, trigger, idempotencyKey, jobId } = event.data;

    console.log(`[Calendar Sync] Starting for user ${userId}, trigger: ${trigger}, jobId: ${jobId}`);

    // STEP 1: IDEMPOTENCY CHECK
    const existingJob = await step.run('check-idempotency', async () => {
      if (!idempotencyKey) return null;

      const { data } = await supabase
        .from('sync_jobs')
        .select('id, status')
        .eq('idempotency_key', idempotencyKey)
        .eq('status', 'complete')
        .single();

      return data;
    });

    if (existingJob) {
      console.log(`[Calendar Sync] Job already completed with idempotency key: ${idempotencyKey}`);
      return { success: true, alreadyComplete: true, jobId: existingJob.id };
    }

    // STEP 2: FETCH AND VERIFY SYNC JOB
    const job = await step.run('fetch-sync-job', async () => {
      const { data, error } = await supabase
        .from('sync_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (error || !data) {
        throw new Error(`Sync job not found: ${jobId}`);
      }

      return data;
    });

    // STEP 3: UPDATE STATUS → 'fetching'
    await step.run('update-status-fetching', async () => {
      await supabase
        .from('sync_jobs')
        .update({ status: 'fetching' })
        .eq('id', jobId);
    });

    // STEP 4: DETERMINE SYNC TYPE & GET CONNECTION
    const connection = await step.run('get-connection', async () => {
      const { data, error } = await supabase
        .from('connections')
        .select('*')
        .eq('id', connectionId)
        .single();

      if (error || !data) {
        throw new Error(`Connection not found: ${connectionId}`);
      }

      return data;
    });

    const lastSyncAt = connection.last_sync_at ? new Date(connection.last_sync_at) : null;
    
    // Determine sync type based on lastSyncAt (NOT syncToken - doesn't work with singleEvents=true)
    const isDeltaSync = !!lastSyncAt;
    console.log(`[Calendar Sync] Sync type: ${isDeltaSync ? 'DELTA (updatedMin)' : 'INITIAL'}, lastSyncAt: ${lastSyncAt?.toISOString() || 'NULL'}`);

    // STEP 5: FETCH CALENDAR EVENTS
    // NOTE: Google Calendar API does NOT return syncToken when singleEvents=true
    // So we use updatedMin (time-based delta sync) instead of syncToken
    // wasDeltaSync tracks if we used updatedMin (delta) vs full time window (initial)
    const { events: allEvents, wasDeltaSync } = await step.run('fetch-events', async () => {
      const nangoConnectionId = connection.connection_id;
      const events: GoogleCalendarEvent[] = [];
      let pageToken: string | null = null;

      console.log(`[Calendar Sync] fetch-events: isDeltaSync = ${isDeltaSync}, lastSyncAt = ${lastSyncAt?.toISOString() || 'NEVER'}, connectionId = ${connectionId}`);

      try {
        // Time window: 7 days back, 30 days forward
        const timeMin = daysAgoUTC(CALENDAR_PAST_DAYS).toISOString();
        const timeMax = daysFromNowUTC(CALENDAR_FUTURE_DAYS).toISOString();

        if (isDeltaSync) {
          // DELTA SYNC: Use updatedMin to get only events modified since last sync
          // This works WITH singleEvents=true (unlike syncToken)
          const updatedMin = lastSyncAt!.toISOString();
          
          console.log(`[Calendar Sync] DELTA sync: updatedMin=${updatedMin}, timeMin=${timeMin}, timeMax=${timeMax}`);

          do {
            const params: Record<string, string | number> = {
              timeMin,
              timeMax,
              updatedMin,  // Only events updated after last sync
              singleEvents: 'true',
              orderBy: 'startTime',
              maxResults: 250,
              showDeleted: 'true',  // Include cancelled events for deletion detection
            };
            if (pageToken) {
              params.pageToken = pageToken;
            }

            const response = await nango.proxy({
              method: 'GET',
              endpoint: '/calendar/v3/calendars/primary/events',
              providerConfigKey: PROVIDER_CONFIG_KEYS.calendar,
              connectionId: nangoConnectionId,
              params,
            });

            const items = response.data?.items || [];
            events.push(...items);
            
            // Log each event's status for debugging
            if (items.length > 0) {
              console.log(`[Calendar Sync] DELTA page: ${items.length} events, statuses: ${items.map((e: GoogleCalendarEvent) => `${e.id}:${e.status}`).join(', ')}`);
            }
            
            pageToken = response.data?.nextPageToken || null;
            console.log(`[Calendar Sync] DELTA page complete: items=${items.length}, hasMorePages=${!!pageToken}`);
          } while (pageToken);

          console.log(`[Calendar Sync] DELTA sync completed: ${events.length} changed events since ${updatedMin}`);
          
          // Log breakdown of event statuses
          const confirmed = events.filter(e => e.status === 'confirmed').length;
          const cancelled = events.filter(e => e.status === 'cancelled').length;
          const tentative = events.filter(e => e.status === 'tentative').length;
          console.log(`[Calendar Sync] DELTA sync breakdown: confirmed=${confirmed}, cancelled=${cancelled}, tentative=${tentative}`);
          
          return { events, wasDeltaSync: true };
        } else {
          // INITIAL SYNC: Fetch all events in time window
          console.log(`[Calendar Sync] INITIAL sync: timeMin=${timeMin}, timeMax=${timeMax}`);

          do {
            const params: Record<string, string | number> = {
              timeMin,
              timeMax,
              singleEvents: 'true',
              orderBy: 'startTime',
              maxResults: 250,
            };
            if (pageToken) {
              params.pageToken = pageToken;
            }

            const response = await nango.proxy({
              method: 'GET',
              endpoint: '/calendar/v3/calendars/primary/events',
              providerConfigKey: PROVIDER_CONFIG_KEYS.calendar,
              connectionId: nangoConnectionId,
              params,
            });

            events.push(...(response.data?.items || []));
            pageToken = response.data?.nextPageToken || null;
            
            console.log(`[Calendar Sync] INITIAL page: items=${response.data?.items?.length || 0}, hasMorePages=${!!pageToken}`);
          } while (pageToken);

          console.log(`[Calendar Sync] INITIAL sync completed: ${events.length} total events in time window`);
          return { events, wasDeltaSync: false };
        }
      } catch (error) {
        const classified = classifyError(error);
        if (classified.action === 'reconnect') {
          await supabase
            .from('connections')
            .update({
              status: 'error',
              metadata: { ...connection.metadata, error_reason: 'Token expired or revoked' },
              updated_at: new Date().toISOString(),
            })
            .eq('id', connectionId);

          await supabase
            .from('sync_jobs')
            .update({
              status: 'error',
              error_message: formatErrorMessage(error),
              error_retryable: false,
              completed_at: new Date().toISOString(),
            })
            .eq('id', jobId);

          throw new Error('Auth error - user must reconnect');
        }
        throw error;
      }
    });

    // STEP 6: PARSE EVENTS
    const parsedEvents = allEvents.map(parseEvent);

    // CRITICAL DEBUG: Log sync type and events received - this helps diagnose update detection issues
    console.log(`[Calendar Sync] ======== SYNC SUMMARY ========`);
    console.log(`[Calendar Sync] Sync type: ${wasDeltaSync ? 'DELTA (only changes)' : 'INITIAL (all events)'}`);
    console.log(`[Calendar Sync] Events from Google: ${allEvents.length}, Parsed: ${parsedEvents.length}`);
    console.log(`[Calendar Sync] wasDeltaSync = ${wasDeltaSync} (CRITICAL for update detection)`);
    console.log(`[Calendar Sync] ==============================`);

    // STEP 7-8: UPDATE STATUS → 'securing' (DLP placeholder)
    await step.run('update-status-securing', async () => {
      await supabase
        .from('sync_jobs')
        .update({ status: 'securing' })
        .eq('id', jobId);
    });

    // STEP 9: UPDATE STATUS → 'persisting'
    await step.run('update-status-persisting', async () => {
      await supabase
        .from('sync_jobs')
        .update({ status: 'persisting' })
        .eq('id', jobId);
    });

    // STEP 10-11: PERSIST WITH DELETION
    // CRITICAL: Pass wasDeltaSync explicitly to avoid closure capture issues with Inngest steps
    const { itemsInserted, itemsDeleted, itemsUpdated } = await step.run('persist-events', async () => {
      // Capture wasDeltaSync value at the start of this step for reliable access
      const isDeltaSync = wasDeltaSync;
      
      // Separate active and cancelled events
      const activeEvents = parsedEvents.filter((e) => e.status !== 'cancelled');
      const cancelledEventIds = parsedEvents
        .filter((e) => e.status === 'cancelled')
        .map((e) => e.event_id);

      // DEBUG: Log event counts and statuses
      console.log(`[Calendar Sync] persist-events input: parsedEvents=${parsedEvents.length}, activeEvents=${activeEvents.length}, cancelledEventIds=${cancelledEventIds.length}`);
      console.log(`[Calendar Sync] Event statuses: ${parsedEvents.map(e => e.status).join(', ')}`);
      if (cancelledEventIds.length > 0) {
        console.log(`[Calendar Sync] Cancelled event IDs to delete: ${cancelledEventIds.join(', ')}`);
      }

      // Count before
      const { count: beforeCount } = await supabase
        .from('calendar_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      // Delete cancelled events WITH PROPER ERROR CHECKING
      let deleted = 0;
      if (cancelledEventIds.length > 0) {
        console.log(`[Calendar Sync] Attempting to delete ${cancelledEventIds.length} cancelled events for user ${userId}`);
        
        const { count, error: deleteError } = await supabase
          .from('calendar_events')
          .delete({ count: 'exact' })
          .eq('user_id', userId)
          .in('event_id', cancelledEventIds);

        if (deleteError) {
          console.error('[Calendar Sync] CRITICAL: Delete calendar_events error:', deleteError);
          throw new Error(`Failed to delete cancelled events: ${deleteError.message}`);
        }

        deleted = count || 0;
        console.log(`[Calendar Sync] Successfully deleted ${deleted} events from calendar_events table`);

        // Also delete their embeddings WITH ERROR CHECKING
        const { error: embeddingDeleteError, count: embeddingsDeleted } = await supabase
          .from('embeddings')
          .delete({ count: 'exact' })
          .eq('user_id', userId)
          .eq('source_type', 'calendar')
          .in('source_id', cancelledEventIds);

        if (embeddingDeleteError) {
          console.error('[Calendar Sync] WARNING: Delete embeddings error:', embeddingDeleteError);
          // Don't throw - embeddings are secondary, but log the error
        } else {
          console.log(`[Calendar Sync] Successfully deleted ${embeddingsDeleted || 0} embeddings for cancelled events`);
        }
      }

      // Add user_id and detect conflicts
      // IMPORTANT: Remove 'status' field as it's not in the database schema
      // (status is only used for filtering cancelled events above)
      const eventsWithUserId = activeEvents.map((e) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { status, ...eventWithoutStatus } = e;
        return {
          ...eventWithoutStatus,
          user_id: userId,
          security_verified: true,
        };
      });

      // Detect conflicts using sweep line algorithm
      const eventsWithConflicts = detectConflicts(eventsWithUserId);

      // UPSERT active events
      if (eventsWithConflicts.length > 0) {
        const upsertBatchSize = 100;
        for (let i = 0; i < eventsWithConflicts.length; i += upsertBatchSize) {
          const batch = eventsWithConflicts.slice(i, i + upsertBatchSize);
          const { error } = await supabase
            .from('calendar_events')
            .upsert(batch, { onConflict: 'user_id,event_id' });

          if (error) {
            console.error('[Calendar Sync] UPSERT error:', error);
            throw new Error(`Calendar UPSERT failed: ${error.message}`);
          }
        }
      }

      // Count after
      const { count: afterCount } = await supabase
        .from('calendar_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      const inserted = Math.max(0, (afterCount || 0) - (beforeCount || 0));

      // CRITICAL FIX: Properly detect updates during delta sync
      // For delta sync: Google ONLY returns CHANGED events (new, modified, or cancelled).
      // If we received active events and count didn't increase, they MUST be updates.
      // For initial sync: We cannot reliably detect updates, so default to 0.
      
      // DEBUG: Log all the values used in calculation
      console.log(`[Calendar Sync] persist-events calculation: isDeltaSync=${isDeltaSync}, activeEvents.length=${activeEvents.length}, inserted=${inserted}, beforeCount=${beforeCount}, afterCount=${afterCount}`);
      
      // ROBUST UPDATE DETECTION:
      // During delta sync, Google returns ONLY changed events:
      // - New events → will be inserted (count increases)
      // - Modified events → will be upserted (count stays same)
      // - Cancelled events → handled separately above
      // Therefore: updated = activeEvents.length - inserted (for delta sync)
      const updated = isDeltaSync
        ? Math.max(0, activeEvents.length - inserted)
        : 0;

      console.log(`[Calendar Sync] persist-events result: itemsInserted=${inserted}, itemsUpdated=${updated}, itemsDeleted=${deleted}`);

      return {
        itemsInserted: inserted,
        itemsDeleted: deleted,
        itemsUpdated: updated,
      };
    });

    console.log(`[Calendar Sync] Items inserted: ${itemsInserted}, updated: ${itemsUpdated}, deleted: ${itemsDeleted}`);

    // STEP 12: CALCULATE TIME-BASED CHANGES
    const changeResult = await step.run('calculate-changes', async () => {
      return calculateCalendarDataChanged(userId, lastSyncAt, itemsInserted, itemsDeleted, itemsUpdated);
    });

    console.log(`[Calendar Sync] Change detection: dataChanged=${changeResult.dataChanged}, timeChanged=${changeResult.timeChanged}, reason=${changeResult.reason}`);

    // STEP 12.5: CALENDAR ANALYSIS
    await step.run('run-analysis', async () => {
      await supabase
        .from('sync_jobs')
        .update({ status: 'analyzing' })
        .eq('id', jobId);

      // Skip analysis only if auto-sync AND no changes (data or time)
      if (trigger === 'auto' && !changeResult.dataChanged && !changeResult.timeChanged) {
        console.log(`[Calendar Sync] Skipping analysis: ${changeResult.reason}`);
        return;
      }

      if (!isGeminiConfigured()) {
        console.warn('[Calendar Sync] GEMINI_API_KEY not configured, skipping analysis');
        return;
      }

      try {
        const analysisResult = await runCalendarAnalysis(userId);

        // UPSERT into calendar_insights
        await supabase
          .from('calendar_insights')
          .upsert({
            user_id: userId,
            content: analysisResult.content,
            conflicts_count: analysisResult.conflicts_count,
            focus_time_hours: analysisResult.focus_time_hours,
            meeting_hours: analysisResult.meeting_hours,
            generated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });

        console.log('[Calendar Sync] Analysis complete');
      } catch (error) {
        console.error('[Calendar Sync] Analysis error:', error);
        // Don't fail the sync for analysis errors
      }
    });

    // STEP 13: CONDITIONAL EMBEDDING GENERATION
    const embeddingResult = await step.run('generate-embeddings', async () => {
      await supabase
        .from('sync_jobs')
        .update({ status: 'embedding' })
        .eq('id', jobId);

      // Skip if auto-sync with no data changes
      if (trigger === 'auto' && !changeResult.dataChanged) {
        console.log('[Calendar Sync] Skipping embeddings - no data changes on auto-sync');
        return { inserted: 0, skipped: 0 };
      }

      // Fetch ALL events for user to embed
      const { data: allStoredEvents } = await supabase
        .from('calendar_events')
        .select('event_id, title, description, start_time, end_time, location')
        .eq('user_id', userId);

      if (!allStoredEvents || allStoredEvents.length === 0) {
        return { inserted: 0, skipped: 0 };
      }

      const inputs = prepareCalendarEmbeddings(allStoredEvents);
      return generateAndStoreEmbeddings(userId, inputs);
    });

    console.log(`[Calendar Sync] Embeddings - inserted: ${embeddingResult.inserted}, skipped: ${embeddingResult.skipped}`);

    // STEP 14: UPDATE CONNECTION (last_sync_at timestamp)
    // NOTE: No syncToken storage needed - we use updatedMin (time-based) approach
    await step.run('update-connection', async () => {
      const { error: updateError } = await supabase
        .from('connections')
        .update({
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', connectionId);

      if (updateError) {
        console.error(`[Calendar Sync] Failed to update connection:`, updateError);
        throw new Error(`Failed to update connection: ${updateError.message}`);
      }
      
      console.log(`[Calendar Sync] Connection last_sync_at updated successfully`);
    });

    // STEP 15: MARK JOB COMPLETE
    await step.run('complete-job', async () => {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'complete',
          items_fetched: allEvents.length,
          items_inserted: itemsInserted,
          items_updated: itemsUpdated,
          items_deleted: itemsDeleted,
          time_changed: changeResult.timeChanged,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    });

    console.log(`[Calendar Sync] Completed for user ${userId}`);

    return {
      success: true,
      itemsFetched: allEvents.length,
      itemsInserted,
      itemsUpdated,
      itemsDeleted,
      dataChanged: changeResult.dataChanged,
      timeChanged: changeResult.timeChanged,
      embeddingsInserted: embeddingResult.inserted,
    };
  }
);

// ============================================================================
// Helper Functions
// ============================================================================

function parseEvent(event: GoogleCalendarEvent): ParsedEvent {
  // All-day event: end.date is EXCLUSIVE
  const isAllDay = !event.end.dateTime;

  let startTime = event.start.dateTime || event.start.date || '';
  let endTime = event.end.dateTime || event.end.date || '';

  if (isAllDay) {
    // Normalize start_time to proper ISO format (midnight UTC)
    if (event.start.date && !event.start.date.includes('T')) {
      startTime = event.start.date + 'T00:00:00.000Z';
    }

    // Subtract 1 day from end_time to make it inclusive
    if (event.end.date) {
      const endDate = new Date(event.end.date);
      endDate.setUTCDate(endDate.getUTCDate() - 1);
      endTime = endDate.toISOString().split('T')[0] + 'T23:59:59.999Z';
    }
  }

  // Sanitize HTML in description
  const description = event.description ? stripHtml(event.description) : null;

  return {
    event_id: event.id,
    title: event.summary || '(No title)',
    description,
    start_time: startTime,
    end_time: endTime,
    is_all_day: isAllDay,
    location: event.location || null,
    attendees: event.attendees || [],
    organizer: event.organizer?.email || null,
    status: event.status,
  };
}

async function calculateCalendarDataChanged(
  userId: string,
  lastSyncAt: Date | null,
  itemsInserted: number,
  itemsDeleted: number,
  itemsUpdated: number = 0
): Promise<CalendarChangeDetection> {
  const now = new Date();
  const todayStartUTC = startOfDayUTC(now);

  // Helper to check if any data changes occurred (inserts, deletes, OR updates)
  const hasDataChanges = itemsInserted > 0 || itemsDeleted > 0 || itemsUpdated > 0;

  // 1. Check if date boundary crossed since last sync
  if (lastSyncAt) {
    const lastSyncDayUTC = startOfDayUTC(lastSyncAt);
    if (todayStartUTC.getTime() > lastSyncDayUTC.getTime()) {
      return {
        dataChanged: hasDataChanges,
        timeChanged: true,
        reason: 'Date boundary crossed - new calendar day in UTC',
      };
    }
  }

  // 2. Check for events that have PASSED since last sync
  if (lastSyncAt) {
    const { count: eventsPassed } = await supabase
      .from('calendar_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('end_time', lastSyncAt.toISOString())
      .lte('end_time', now.toISOString());

    if ((eventsPassed || 0) > 0) {
      return {
        dataChanged: hasDataChanges,
        timeChanged: true,
        reason: `${eventsPassed} event(s) have ended since last sync`,
      };
    }
  }

  // 3. Check for events that have NEWLY entered the 24-hour window
  const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (lastSyncAt) {
    const was24hThreshold = new Date(lastSyncAt.getTime() + 24 * 60 * 60 * 1000);
    const { count: eventsNowUrgent } = await supabase
      .from('calendar_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('start_time', was24hThreshold.toISOString())
      .lte('start_time', in24Hours.toISOString());

    if ((eventsNowUrgent || 0) > 0) {
      return {
        dataChanged: hasDataChanges,
        timeChanged: true,
        reason: `${eventsNowUrgent} event(s) newly entered 24-hour urgent window`,
      };
    }
  }

  // 4. Check for IMMINENT events (starting in 20-30 minutes)
  // This triggers briefing regeneration ~30 minutes before each event.
  // With 10-minute auto-sync intervals, each event triggers EXACTLY ONCE.
  // Window: (NOW + 20min, NOW + 30min] - exclusive start, inclusive end
  const imminentWindowStart = new Date(now.getTime() + IMMINENT_REANALYSIS_WINDOW_START_MINUTES * 60 * 1000);
  const imminentWindowEnd = new Date(now.getTime() + IMMINENT_REANALYSIS_WINDOW_END_MINUTES * 60 * 1000);
  
  const { count: imminentEvents } = await supabase
    .from('calendar_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gt('start_time', imminentWindowStart.toISOString())    // start_time > NOW + 20min
    .lte('start_time', imminentWindowEnd.toISOString());    // start_time <= NOW + 30min

  if ((imminentEvents || 0) > 0) {
    console.log(`[Calendar Sync] Imminent event detected: ${imminentEvents} event(s) starting in ${IMMINENT_REANALYSIS_WINDOW_START_MINUTES}-${IMMINENT_REANALYSIS_WINDOW_END_MINUTES} minutes`);
    return {
      dataChanged: hasDataChanges,
      timeChanged: true,
      reason: `${imminentEvents} event(s) starting in ${IMMINENT_REANALYSIS_WINDOW_START_MINUTES}-${IMMINENT_REANALYSIS_WINDOW_END_MINUTES} minutes - pre-event briefing regeneration`,
    };
  }

  // 5. Standard data-based change detection - NOW INCLUDES UPDATES
  return {
    dataChanged: hasDataChanges,
    timeChanged: false,
    reason: hasDataChanges
      ? `${itemsInserted} inserted, ${itemsUpdated} updated, ${itemsDeleted} deleted`
      : 'No changes detected',
  };
}

async function runCalendarAnalysis(userId: string): Promise<{
  content: Record<string, unknown>;
  conflicts_count: number;
  focus_time_hours: number;
  meeting_hours: number;
}> {
  // Fetch events in analysis window (7 days past, 14 days future)
  const pastDate = daysAgoUTC(CALENDAR_ANALYSIS_PAST_DAYS).toISOString();
  const futureDate = daysFromNowUTC(CALENDAR_ANALYSIS_FUTURE_DAYS).toISOString();

  const { data: events } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('user_id', userId)
    .gte('start_time', pastDate)
    .lte('start_time', futureDate)
    .order('start_time', { ascending: true });

  const calendarEvents = (events || []).map((e) => ({
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

  // Get conflict details and focus blocks
  const conflicts = getConflictDetails(calendarEvents);
  const focusBlocks = identifyFocusBlocks(calendarEvents, new Date());

  // Build prompt and call Gemini
  const prompt = buildCalendarAnalysisPrompt(calendarEvents, conflicts, focusBlocks);
  const responseText = await callGeminiJSON(prompt);

  // Parse response
  let content: Record<string, unknown>;
  try {
    content = JSON.parse(responseText);
  } catch {
    console.error('[Calendar Sync] Failed to parse analysis response:', responseText);
    content = { error: 'Failed to parse analysis', raw: responseText };
  }

  // Extract metrics
  const metrics = (content.metrics || {}) as Record<string, number>;

  return {
    content,
    conflicts_count: metrics.conflictCount || conflicts.length,
    focus_time_hours: metrics.focusHoursAvailable || focusBlocks.reduce((sum, b) => sum + b.durationHours, 0),
    meeting_hours: metrics.meetingHoursTotal || 0,
  };
}
