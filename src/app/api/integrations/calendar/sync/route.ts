import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { inngest } from '@/lib/inngest';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { Database } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Nango } from '@nangohq/node';
import { scanContent } from '@/lib/nightfall';
import { upsertPiiVaultTokens } from '@/lib/pii-vault';
import { runCalendarAnalysisForUser } from '@/lib/calendar-analysis';
import { CalendarConfig } from '@/lib/config/data-scope';

function getDlpConfigIssue(): string | null {
  if (!process.env.NIGHTFALL_API_KEY) return 'Missing NIGHTFALL_API_KEY on server (DLP gate required)';
  const keyB64 = process.env.PII_VAULT_KEY_BASE64;
  if (!keyB64) return 'Missing PII_VAULT_KEY_BASE64 on server (PII vault encryption key required)';
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) return 'PII_VAULT_KEY_BASE64 must decode to 32 bytes (AES-256 key)';
  return null;
}

function parseProxyData(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

type GoogleCalendarApiEvent = {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  status?: string;
  attendees?: unknown[];
};

/**
 * Fetch ALL Calendar events with pagination (no limit)
 */
async function fetchAllCalendarEvents(
  nango: Nango,
  connectionId: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
  pageSize: number = 100
): Promise<{ events: GoogleCalendarApiEvent[]; syncToken?: string }> {
  const allEvents: GoogleCalendarApiEvent[] = [];
  let pageToken: string | undefined = undefined;
  let syncToken: string | undefined = undefined;

  do {
    const response = await nango.proxy({
      connectionId,
      providerConfigKey: 'google-calendar',
      method: 'GET',
      endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      params: {
        maxResults: String(pageSize),
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        ...(pageToken && { pageToken }),
      },
    });

    const parsed = parseProxyData(response.data) as { items?: unknown[]; nextPageToken?: string; nextSyncToken?: string } | undefined;
    const items = typeof parsed === 'object' && parsed && Array.isArray(parsed.items)
      ? (parsed.items as GoogleCalendarApiEvent[])
      : [];

    allEvents.push(...items);
    pageToken = parsed?.nextPageToken;
    
    if (!pageToken) {
      syncToken = parsed?.nextSyncToken;
    }
  } while (pageToken);

  return { events: allEvents, syncToken };
}

/**
 * Fetch Calendar events using syncToken for delta sync
 */
async function fetchCalendarEventsWithSyncToken(
  nango: Nango,
  connectionId: string,
  calendarId: string,
  syncToken: string
): Promise<{ events: GoogleCalendarApiEvent[]; newSyncToken?: string; tokenInvalid?: boolean }> {
  try {
    const response = await nango.proxy({
      connectionId,
      providerConfigKey: 'google-calendar',
      method: 'GET',
      endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      params: { syncToken },
    });

    const parsed = parseProxyData(response.data) as { items?: unknown[]; nextSyncToken?: string } | undefined;
    const items = typeof parsed === 'object' && parsed && Array.isArray(parsed.items)
      ? (parsed.items as GoogleCalendarApiEvent[])
      : [];

    return { events: items, newSyncToken: parsed?.nextSyncToken };
  } catch (error: unknown) {
    const err = error as { response?: { status?: number } };
    if (err.response?.status === 410) {
      return { events: [], tokenInvalid: true };
    }
    throw error;
  }
}

export async function POST() {
  let authedUserId: string | null = null;
  try {
    const { userId } = await auth();
    authedUserId = userId || null;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    type ConnectionRow = Database['public']['Tables']['connections']['Row'];

    const supa = supabaseAdmin as unknown as SupabaseClient;
    const { data: primaryConnection, error: connError } = await supa
      .from('connections')
      .select('connection_id, last_sync_at, metadata')
      .eq('user_id', userId)
      .eq('provider', 'calendar')
      .maybeSingle<Pick<ConnectionRow, 'connection_id'> & { last_sync_at?: string; metadata?: unknown }>();

    if (connError) {
      console.error('Failed to fetch calendar connection', connError);
      return NextResponse.json({ error: 'Unable to find calendar connection' }, { status: 500 });
    }

    let connectionId: string | null = primaryConnection?.connection_id || null;
    const connMetadata = (primaryConnection?.metadata || {}) as { syncToken?: string };
    const existingSyncToken = connMetadata.syncToken;

    // Fallback 1: legacy rows
    if (!connectionId) {
      const { data: metaConnection } = await supa
        .from('connections')
        .select('connection_id')
        .eq('provider', 'calendar')
        .contains('metadata', { clerk_user_id: userId })
        .maybeSingle<Pick<ConnectionRow, 'connection_id'>>();
      connectionId = metaConnection?.connection_id || null;
    }

    // Fallback 2: sole connected calendar
    if (!connectionId) {
      const { data: allConnections } = await supa
        .from('connections')
        .select('connection_id,user_id')
        .eq('provider', 'calendar')
        .eq('status', 'connected');

      if (Array.isArray(allConnections) && allConnections.length === 1) {
        connectionId = allConnections[0]?.connection_id || null;
      }
    }

    if (!connectionId) {
      return NextResponse.json({
        success: true,
        eventsSynced: 0,
        warning: 'Calendar not connected.',
      });
    }

    await supa
      .from('sync_status')
      .upsert(
        {
          user_id: userId,
          status: 'fetching',
          current_provider: 'calendar',
          error_message: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    // Send event to Inngest
    await inngest.send({
      name: 'calendar/connection.established',
      data: {
        userId,
        connectionId,
        providerConfigKey: 'google-calendar',
        trigger: 'manual',
        timestamp: new Date().toISOString(),
      },
    });

    const nangoSecretKey = process.env.NANGO_SECRET_KEY;
    if (!nangoSecretKey) {
      await supa
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'error',
            current_provider: 'calendar',
            error_message: 'Nango not configured',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      return NextResponse.json({
        success: true,
        eventsSynced: 0,
        warning: 'Nango not configured.',
      });
    }

    const nango = new Nango({ secretKey: nangoSecretKey });
    
    // ═══════════════════════════════════════════════════════════════════════
    // CALENDAR SYNC - Determine INITIAL vs DELTA sync
    // ═══════════════════════════════════════════════════════════════════════
    
    const isInitialSync = !existingSyncToken;
    let items: GoogleCalendarApiEvent[] = [];
    let newSyncToken: string | undefined;

    try {
      if (isInitialSync) {
        // INITIAL SYNC: Full time range with pagination
        const timeRange = CalendarConfig.initialSync.getTimeRange();
        const timeMin = timeRange.from.toISOString();
        const timeMax = timeRange.to.toISOString();

        console.log(`[Calendar Sync API] INITIAL SYNC - TimeMin: ${timeMin}, TimeMax: ${timeMax}`);

        const result = await fetchAllCalendarEvents(
          nango,
          connectionId,
          'primary',
          timeMin,
          timeMax,
          CalendarConfig.initialSync.pageSize
        );
        
        items = result.events;
        newSyncToken = result.syncToken;
        
      } else {
        // DELTA SYNC: Use syncToken
        console.log(`[Calendar Sync API] DELTA SYNC with syncToken`);
        
        const result = await fetchCalendarEventsWithSyncToken(
          nango,
          connectionId,
          'primary',
          existingSyncToken
        );
        
        if (result.tokenInvalid) {
          // Token expired, do full sync
          console.log(`[Calendar Sync API] syncToken invalid, falling back to full sync`);
          const timeRange = CalendarConfig.deltaSync.fallbackTimeRange();
          const result2 = await fetchAllCalendarEvents(
            nango,
            connectionId,
            'primary',
            timeRange.from.toISOString(),
            timeRange.to.toISOString(),
            CalendarConfig.deltaSync.pageSize
          );
          items = result2.events;
          newSyncToken = result2.syncToken;
        } else {
          items = result.events;
          newSyncToken = result.newSyncToken;
        }
      }
    } catch (nangoError) {
      console.error('Nango calendar sync failed', nangoError);
      await supa
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'error',
            current_provider: 'calendar',
            error_message: 'Calendar sync failed',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      return NextResponse.json({
        success: true,
        eventsSynced: 0,
        warning: 'Calendar sync failed.',
      });
    }

    console.log(`[Calendar Sync API] Total events fetched: ${items.length}`);

    // Fallback: check other calendars if primary is empty
    if (items.length === 0 && isInitialSync) {
      try {
        const timeRange = CalendarConfig.initialSync.getTimeRange();
        const timeMin = timeRange.from.toISOString();
        const timeMax = timeRange.to.toISOString();

        const calListRes = await nango.proxy({
          connectionId,
          providerConfigKey: 'google-calendar',
          method: 'GET',
          endpoint: '/calendar/v3/users/me/calendarList',
          params: { maxResults: '50' },
        });

        const calListParsed = parseProxyData(calListRes.data) as { items?: unknown[] } | string | undefined;
        const calendars =
          typeof calListParsed === 'object' && calListParsed && Array.isArray(calListParsed.items)
            ? (calListParsed.items as Array<{ id?: string; primary?: boolean }>)
            : [];

        const candidates = calendars
          .filter((c) => Boolean(c?.id))
          .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0))
          .slice(0, 5);

        for (const cal of candidates) {
          const calId = String(cal.id);
          const result = await fetchAllCalendarEvents(nango, connectionId, calId, timeMin, timeMax, 50);
          if (result.events.length > 0) {
            items = result.events;
            newSyncToken = result.syncToken;
            break;
          }
        }
      } catch (fallbackError) {
        console.error('Calendar fallback scan failed', fallbackError);
      }
    }

    type CalendarEventInsert = Database['public']['Tables']['calendar_events']['Insert'];

    const events = items.map((item) => {
      const start = item.start?.dateTime || item.start?.date || '';
      const end = item.end?.dateTime || item.end?.date || '';
      return {
        user_id: userId,
        event_id: item.id,
        calendar_id: 'primary',
        title: item.summary || 'Untitled Event',
        description: '',
        start_time: start,
        end_time: end,
        location: item.location || undefined,
        attendees: (item.attendees as string[]) || [],
        is_all_day: false,
        status: (item.status || 'confirmed') as 'confirmed' | 'tentative' | 'cancelled',
        has_conflict: false,
        conflict_with: [] as string[],
      } satisfies CalendarEventInsert;
    }) as CalendarEventInsert[];

    if (events.length > 0) {
      const dlpIssue = getDlpConfigIssue();
      
      await supa
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'securing',
            current_provider: 'calendar',
            error_message: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

      // DLP scan events - graceful fallback on failure (continue without redaction)
      // CRITICAL: If DLP is not configured, continue WITHOUT redaction rather than failing
      if (dlpIssue) {
        console.warn(`[Calendar Sync] DLP not configured: ${dlpIssue}, continuing without redaction`);
      } else {
        try {
          for (const ev of events) {
            const scanned = await scanContent(`${ev.title}\n${ev.location || ''}`);
            await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });
            const [titleLine, ...locLines] = scanned.redacted.split('\n');
            ev.title = titleLine || ev.title;
            const loc = locLines.join('\n').trim();
            ev.location = loc || ev.location;
          }
        } catch (dlpError) {
          // DLP failed (rate limit, config, etc.) - continue WITHOUT redaction
          // Better to sync unredacted data than fail entirely
          console.warn('[Calendar Sync] DLP scan failed, continuing without redaction:', dlpError);
        }
      }

      const { error: upsertError } = await supa
        .from('calendar_events')
        .upsert(events, { onConflict: 'user_id,event_id' });
      if (upsertError) {
        console.error('Calendar upsert error', upsertError);
      }

      // Conflict detection
      const sorted = events
        .filter((ev) => ev.status !== 'cancelled')
        .map((ev) => ({
          ...ev,
          start: new Date(ev.start_time).getTime(),
          end: new Date(ev.end_time).getTime(),
        }))
        .sort((a, b) => a.start - b.start);

      const conflicts: Record<string, string[]> = {};
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          if (sorted[j].start > sorted[i].end + 60 * 60 * 1000) break;
          if (sorted[j].start < sorted[i].end) {
            conflicts[sorted[i].event_id] = [...(conflicts[sorted[i].event_id] || []), sorted[j].event_id];
            conflicts[sorted[j].event_id] = [...(conflicts[sorted[j].event_id] || []), sorted[i].event_id];
          }
        }
      }

      for (const ev of events) {
        const overlapIds = conflicts[ev.event_id] || [];
        await supa
          .from('calendar_events')
          .update({ has_conflict: overlapIds.length > 0, conflict_with: overlapIds })
          .eq('user_id', userId)
          .eq('event_id', ev.event_id);
      }
    }

    // Update connection with last_sync_at AND new syncToken
    const updatePayload: Record<string, unknown> = {
      last_sync_at: new Date().toISOString(),
      status: 'connected',
    };
    
    if (newSyncToken) {
      updatePayload.metadata = { ...connMetadata, syncToken: newSyncToken };
    }
    
    await supa
      .from('connections')
      .update(updatePayload)
      .eq('user_id', userId)
      .eq('provider', 'calendar');

    await supa
      .from('sync_status')
      .upsert(
        {
          user_id: userId,
          status: 'complete',
          current_provider: null,
          error_message: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    // Calendar analysis - ONLY run if data actually changed
    // This prevents unnecessary Gemini API calls during auto-sync with no new events
    const dataChanged = events.length > 0;
    let analysisResult: { 
      success: boolean; 
      eventsAnalyzed?: number; 
      conflictsCount?: number; 
      totalIssues?: number;
      error?: string;
    } | null = null;
    
    if (dataChanged) {
      try {
        console.log(`[Calendar Sync] Running analysis (${events.length} events changed)`);
        const result = await runCalendarAnalysisForUser({ userId });
        analysisResult = {
          success: true,
          eventsAnalyzed: result.eventsAnalyzed,
          conflictsCount: result.conflictsCount,
          totalIssues: result.totalIssues,
        };
        await inngest.send({
          name: 'calendar/events.synced',
          data: { userId, timestamp: new Date().toISOString() },
        });
      } catch (analysisError) {
        console.error('Calendar analysis failed (non-blocking)', analysisError);
        analysisResult = {
          success: false,
          error: analysisError instanceof Error ? analysisError.message : 'Analysis failed',
        };
      }
    } else {
      console.log(`[Calendar Sync] Skipping analysis (no data changes)`);
      analysisResult = { success: true, eventsAnalyzed: 0, conflictsCount: 0, totalIssues: 0 };
    }

    return NextResponse.json({
      success: true,
      eventsSynced: events.length,
      fetchedEvents: items.length,
      syncType: isInitialSync ? 'initial' : 'delta',
      dataChanged,
      analysisResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Calendar sync trigger failed', error);
    if (authedUserId) {
      try {
        const supa = supabaseAdmin as unknown as SupabaseClient;
        await supa
          .from('sync_status')
          .upsert(
            {
              user_id: authedUserId,
              status: 'error',
              current_provider: 'calendar',
              error_message: message,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );
      } catch {
        // best-effort
      }
    }
    return NextResponse.json({ error: 'Failed to trigger calendar sync', details: message }, { status: 500 });
  }
}
