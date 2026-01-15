import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { inngest } from '@/lib/inngest';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { Database } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Nango } from '@nangohq/node';

export async function POST() {
  try {
    const { userId } = await auth();
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

    const items: GoogleCalendarApiEvent[] = response.data?.items || [];
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
      const { error: upsertError } = await supa
        .from('calendar_events')
        .upsert(events, { onConflict: 'user_id,event_id' });
      if (upsertError) {
        console.error('Calendar upsert error', upsertError);
      }

      // Simple conflict detection on fetched set
      const sorted = events
        .map((ev) => ({
          ...ev,
          start: new Date(ev.start_time).getTime(),
          end: new Date(ev.end_time).getTime(),
        }))
        .sort((a, b) => a.start - b.start);

      const conflicts: Record<string, string[]> = {};
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          if (sorted[j].start < sorted[i].end) {
            conflicts[sorted[i].event_id] = [
              ...(conflicts[sorted[i].event_id] || []),
              sorted[j].event_id,
            ];
            conflicts[sorted[j].event_id] = [
              ...(conflicts[sorted[j].event_id] || []),
              sorted[i].event_id,
            ];
          } else {
            break;
          }
        }
      }

      for (const [eventId, overlapIds] of Object.entries(conflicts)) {
        const { error } = await supa
          .from('calendar_events')
          .update({
            has_conflict: overlapIds.length > 0,
            conflict_with: overlapIds,
          })
          .eq('user_id', userId)
          .eq('event_id', eventId);
        if (error) {
          console.error('Conflict update error', error);
        }
      }
    }

    return NextResponse.json({ success: true, eventsSynced: events.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Calendar sync trigger failed', error);
    return NextResponse.json({ error: 'Failed to trigger calendar sync', details: message }, { status: 500 });
  }
}
