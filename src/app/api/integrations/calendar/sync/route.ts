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

export async function POST() {
  let authedUserId: string | null = null;
  try {
    const { userId } = await auth();
    authedUserId = userId || null;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch stored Nango connectionId for this user/provider
    type ConnectionRow = Database['public']['Tables']['connections']['Row'];

    const supa = supabaseAdmin as unknown as SupabaseClient;
    const { data: primaryConnection, error: connError } = await supa
      .from('connections')
      .select('connection_id')
      .eq('user_id', userId)
      .eq('provider', 'calendar')
      .maybeSingle<Pick<ConnectionRow, 'connection_id'>>();

    if (connError) {
      console.error('Failed to fetch calendar connection', connError);
      return NextResponse.json({ error: 'Unable to find calendar connection' }, { status: 500 });
    }

    let connectionId: string | null = primaryConnection?.connection_id || null;

    // Fallback 1: legacy rows where user_id was not the Clerk userId but stored in metadata
    if (!connectionId) {
      const { data: metaConnection } = await supa
        .from('connections')
        .select('connection_id')
        .eq('provider', 'calendar')
        .contains('metadata', { clerk_user_id: userId })
        .maybeSingle<Pick<ConnectionRow, 'connection_id'>>();
      connectionId = metaConnection?.connection_id || null;
    }

    // Fallback 2: if there's exactly ONE connected calendar row in this project, use it (alpha-safe)
    if (!connectionId) {
      const { data: allConnections } = await supa
        .from('connections')
        .select('connection_id,user_id')
        .eq('provider', 'calendar')
        .eq('status', 'connected');

      if (Array.isArray(allConnections) && allConnections.length === 1) {
        connectionId = allConnections[0]?.connection_id || null;
        console.warn('Using sole calendar connection row as fallback.', {
          clerkUserId: userId,
          storedUserId: allConnections[0]?.user_id,
        });
      }
    }

    if (!connectionId) {
      return NextResponse.json({
        success: true,
        eventsSynced: 0,
        warning: 'Calendar not connected. Please reconnect via Nango so the webhook can store the correct connection_id.',
      });
    }

    // Ensure the UI doesn't get stuck if Inngest doesn't execute: we drive status transitions here.
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

    // Send event to Inngest (asynchronous pipeline)
    await inngest.send({
      name: 'calendar/connection.established',
      data: {
        userId,
        connectionId,
        providerConfigKey: 'google-calendar',
        timestamp: new Date().toISOString(),
      },
    });

    // Also perform a direct sync for immediate UI feedback
    const nangoSecretKey = process.env.NANGO_SECRET_KEY;
    if (!nangoSecretKey) {
      await supa
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'error',
            current_provider: 'calendar',
            error_message: 'Nango not configured on server',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      return NextResponse.json({
        success: true,
        eventsSynced: 0,
        warning: 'Nango not configured on server. Set NANGO_SECRET_KEY and reconnect Calendar.',
      });
    }

    let response;
    try {
      const nango = new Nango({ secretKey: nangoSecretKey });
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      response = await nango.proxy({
        connectionId,
        providerConfigKey: 'google-calendar',
        method: 'GET',
        endpoint: '/calendar/v3/calendars/primary/events',
        params: {
          singleEvents: 'true',
          orderBy: 'startTime',
          timeMin,
          timeMax,
          maxResults: '50',
        },
      });
    } catch (nangoError) {
      console.error('Nango calendar sync failed', nangoError);
      await supa
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'error',
            current_provider: 'calendar',
            error_message: 'Calendar sync could not reach Nango',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      return NextResponse.json({
        success: true,
        eventsSynced: 0,
        warning: 'Calendar sync could not reach Nango. Ensure the Calendar connection is active.',
      });
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

    const parsed = parseProxyData(response.data) as { items?: unknown[] } | string | undefined;
    const primaryItems = typeof parsed === 'object' && parsed && Array.isArray(parsed.items)
      ? (parsed.items as GoogleCalendarApiEvent[])
      : [];

    let items: GoogleCalendarApiEvent[] = primaryItems;
    // Fallback: if primary is empty, attempt other visible calendars (helps when events live in a secondary calendar)
    if (items.length === 0) {
      try {
        const nango = new Nango({ secretKey: nangoSecretKey });
        const timeMin = new Date().toISOString();
        const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

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
            ? (calListParsed.items as Array<{ id?: string; selected?: boolean; primary?: boolean }>)
            : [];

        const candidates = calendars
          .filter((c) => Boolean(c?.id))
          .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0))
          .slice(0, 5);

        for (const cal of candidates) {
          const calId = String(cal.id);
          const evRes = await nango.proxy({
            connectionId,
            providerConfigKey: 'google-calendar',
            method: 'GET',
            endpoint: `/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
            params: {
              singleEvents: 'true',
              orderBy: 'startTime',
              timeMin,
              timeMax,
              maxResults: '50',
            },
          });
          const evParsed = parseProxyData(evRes.data) as { items?: unknown[] } | string | undefined;
          const evItems =
            typeof evParsed === 'object' && evParsed && Array.isArray(evParsed.items)
              ? (evParsed.items as GoogleCalendarApiEvent[])
              : [];
          if (evItems.length > 0) {
            items = evItems;
            break;
          }
        }
      } catch (fallbackError) {
        console.error('Calendar fallback calendarList scan failed', fallbackError);
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
      if (dlpIssue) {
        await supa
          .from('sync_status')
          .upsert(
            {
              user_id: userId,
              status: 'error',
              current_provider: 'calendar',
              error_message: dlpIssue,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );
        return NextResponse.json({
          success: true,
          eventsSynced: 0,
          warning: dlpIssue,
        });
      }

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

      // Nightfall DLP gate before storage
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
        const details = dlpError instanceof Error ? dlpError.message : 'Unknown DLP error';
        console.error('Calendar DLP gate failed', dlpError);
        await supa
          .from('sync_status')
          .upsert(
            {
              user_id: userId,
              status: 'error',
              current_provider: 'calendar',
              error_message: `Calendar DLP gate failed: ${details}`,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );
        return NextResponse.json({
          success: true,
          eventsSynced: 0,
          warning: `Calendar data was NOT stored because DLP failed: ${details}`,
        });
      }

      const { error: upsertError } = await supa
        .from('calendar_events')
        .upsert(events, { onConflict: 'user_id,event_id' });
      if (upsertError) {
        console.error('Calendar upsert error', upsertError);
      }

      // Note: Advanced conflict detection is handled by calendar-analysis.ts
      // Here we just do a basic hard-overlap pass for immediate UI feedback
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
          // Stop checking if eventB starts more than an hour after eventA ends
          if (sorted[j].start > sorted[i].end + 60 * 60 * 1000) break;
          
          // Hard overlap: eventB starts before eventA ends
          if (sorted[j].start < sorted[i].end) {
            conflicts[sorted[i].event_id] = [
              ...(conflicts[sorted[i].event_id] || []),
              sorted[j].event_id,
            ];
            conflicts[sorted[j].event_id] = [
              ...(conflicts[sorted[j].event_id] || []),
              sorted[i].event_id,
            ];
          }
        }
      }

      // Update conflict flags
      for (const ev of events) {
        const overlapIds = conflicts[ev.event_id] || [];
        const { error } = await supa
          .from('calendar_events')
          .update({
            has_conflict: overlapIds.length > 0,
            conflict_with: overlapIds,
          })
          .eq('user_id', userId)
          .eq('event_id', ev.event_id);
        if (error) {
          console.error('Conflict update error', error);
        }
      }
    }

    // Mark sync completion for UI (even if 0 events were returned).
    await supa
      .from('connections')
      .update({ last_sync_at: new Date().toISOString(), status: 'connected' })
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

    // Time Sovereignty Pipeline: analyze next 7 days (best-effort; never block sync success)
    try {
      await runCalendarAnalysisForUser({ userId });
      await inngest.send({
        name: 'calendar/events.synced',
        data: { userId, timestamp: new Date().toISOString() },
      });
    } catch (analysisError) {
      console.error('Calendar analysis failed (non-blocking)', analysisError);
    }

    return NextResponse.json({
      success: true,
      eventsSynced: events.length,
      fetchedEvents: items.length,
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
