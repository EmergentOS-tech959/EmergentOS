import { inngest } from './inngest';
import { Nango } from '@nangohq/node';
import { createClient } from '@supabase/supabase-js';

// Initialize Nango client
const nango = new Nango({
  secretKey: process.env.NANGO_SECRET_KEY!,
});

// Supabase admin client (service role)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface GmailHeader {
  name: string;
  value: string;
}

interface ParsedEmail {
  id: string;
  from: string;
  subject: string;
  date: string;
}

interface ParsedCalendarEvent {
  eventId: string;
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  attendees?: unknown[];
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
 * Gmail sync (Phase 0)
 */
export const processGmailConnection = inngest.createFunction(
  { id: 'process-gmail-connection', name: 'Process Gmail Connection', retries: 3 },
  { event: 'gmail/connection.established' },
  async ({ event, step }) => {
    const { userId, connectionId } = event.data;
    const nangoConnectionId = connectionId || userId;

    await step.run('update-status-fetching', async () => {
      const { error } = await supabaseAdmin
        .from('sync_status')
        .upsert(
          { user_id: userId, status: 'fetching', updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      if (error) throw error;
    });

    const emails = await step.run('fetch-gmail-emails', async () => {
      const listResponse = await nango.proxy({
        connectionId: nangoConnectionId,
        providerConfigKey: 'google-mail',
        method: 'GET',
        endpoint: '/gmail/v1/users/me/messages',
        params: { maxResults: '5', q: 'in:inbox' },
      });

      const messages = listResponse.data?.messages || [];
      if (messages.length === 0) return [];

      const emailDetails: ParsedEmail[] = await Promise.all(
        messages.slice(0, 5).map(async (msg: { id: string }) => {
          const detailResponse = await nango.proxy({
            connectionId: nangoConnectionId,
            providerConfigKey: 'google-mail',
            method: 'GET',
            endpoint: `/gmail/v1/users/me/messages/${msg.id}`,
            params: { format: 'full' },
          });

          const responseData = detailResponse.data;
          let headers: GmailHeader[] = [];
          if (responseData?.payload?.headers) headers = responseData.payload.headers;
          else if (Array.isArray(responseData?.headers)) headers = responseData.headers;

          const getHeader = (name: string): string => {
            const header = headers.find((h: GmailHeader) => h.name?.toLowerCase() === name.toLowerCase());
            return header?.value || 'Unknown';
          };

          return {
            id: msg.id,
            from: getHeader('From'),
            subject: getHeader('Subject'),
            date: getHeader('Date'),
          };
        })
      );

      return emailDetails;
    });

    await step.run('update-status-securing', async () => {
      const { error } = await supabaseAdmin
        .from('sync_status')
        .upsert(
          { user_id: userId, status: 'securing', updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      if (error) throw error;
    });

    await step.sleep('mock-dlp-scan', '2s');

    await step.run('persist-emails', async () => {
      const { error: deleteError } = await supabaseAdmin.from('emails').delete().eq('user_id', userId);
      if (deleteError) console.error('Failed to delete existing emails', deleteError);

      if (emails.length > 0) {
        const rows = emails.map((email: ParsedEmail) => ({
          user_id: userId,
          message_id: email.id,
          sender: email.from,
          subject: email.subject || 'No Subject',
          received_at: email.date,
          security_verified: true,
        }));

        const { error: insertError } = await supabaseAdmin.from('emails').insert(rows);
        if (insertError) throw insertError;
      }
    });

    await step.run('update-status-complete', async () => {
      const { error } = await supabaseAdmin
        .from('sync_status')
        .upsert(
          { user_id: userId, status: 'complete', updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      if (error) throw error;
    });

    return {
      success: true,
      userId,
      emailsProcessed: emails.length,
      timestamp: new Date().toISOString(),
    };
  }
);

/**
 * Calendar sync (Phase 1)
 */
export const syncCalendarEvents = inngest.createFunction(
  { id: 'sync-calendar-events', name: 'Sync Calendar Events', retries: 3 },
  { event: 'calendar/connection.established' },
  async ({ event, step }) => {
    const { userId, connectionId } = event.data;
    const nangoConnectionId = connectionId || userId;

    await step.run('update-status-fetching-calendar', async () => {
      const { error } = await supabaseAdmin
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'fetching',
            current_provider: 'calendar',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      if (error) throw error;
    });

    const events: ParsedCalendarEvent[] = await step.run('fetch-calendar-events', async () => {
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const response = await nango.proxy({
        connectionId: nangoConnectionId,
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

      const items: GoogleCalendarApiEvent[] = response.data?.items || [];
      return items.map((item) => {
        const start = item.start?.dateTime || item.start?.date || '';
        const end = item.end?.dateTime || item.end?.date || '';
        return {
          eventId: item.id,
          title: item.summary || 'Untitled Event',
          startTime: start,
          endTime: end,
          location: item.location || undefined,
          status: (item.status || 'confirmed') as ParsedCalendarEvent['status'],
          attendees: item.attendees || [],
        };
      });
    });

    await step.run('update-status-securing-calendar', async () => {
      const { error } = await supabaseAdmin
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'securing',
            current_provider: 'calendar',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      if (error) throw error;
    });

    await step.sleep('mock-calendar-dlp', '2s');

    await step.run('persist-calendar-events', async () => {
      if (events.length > 0) {
        const rows = events.map((ev) => ({
          user_id: userId,
          event_id: ev.eventId,
          title: ev.title,
          description: '',
          start_time: ev.startTime,
          end_time: ev.endTime,
          location: ev.location,
          attendees: ev.attendees || [],
          status: ev.status,
          has_conflict: false,
          conflict_with: [],
        }));

        const { error: upsertError } = await supabaseAdmin
          .from('calendar_events')
          .upsert(rows, { onConflict: 'user_id,event_id' });
        if (upsertError) throw upsertError;
      }

      // Conflict detection
      const sorted = events
        .map((ev) => ({
          ...ev,
          start: new Date(ev.startTime).getTime(),
          end: new Date(ev.endTime).getTime(),
        }))
        .sort((a, b) => a.start - b.start);

      const conflicts: Record<string, string[]> = {};
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          if (sorted[j].start < sorted[i].end) {
            conflicts[sorted[i].eventId] = [...(conflicts[sorted[i].eventId] || []), sorted[j].eventId];
            conflicts[sorted[j].eventId] = [...(conflicts[sorted[j].eventId] || []), sorted[i].eventId];
          } else {
            break;
          }
        }
      }

      for (const [eventId, overlapIds] of Object.entries(conflicts)) {
        const { error } = await supabaseAdmin
          .from('calendar_events')
          .update({
            has_conflict: overlapIds.length > 0,
            conflict_with: overlapIds,
          })
          .eq('user_id', userId)
          .eq('event_id', eventId);
        if (error) throw error;
      }
    });

    await step.run('update-status-complete-calendar', async () => {
      const { error } = await supabaseAdmin
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'complete',
            current_provider: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      if (error) throw error;
    });

    return {
      success: true,
      userId,
      eventsProcessed: events.length,
      timestamp: new Date().toISOString(),
    };
  }
);

// Export all functions
export const functions = [processGmailConnection, syncCalendarEvents];
