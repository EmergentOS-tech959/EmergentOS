import { inngest } from './inngest';
import { Nango } from '@nangohq/node';
import { supabaseAdmin } from './supabase-server';
import { scanContent } from './nightfall';
import { upsertPiiVaultTokens } from './pii-vault';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateBriefingForUser, listBriefingUserIds } from './briefing-generator';
import { runCalendarAnalysisForUser } from './calendar-analysis';

// Initialize Nango client
const nango = new Nango({ 
  secretKey: process.env.NANGO_SECRET_KEY!,
});

const supa = supabaseAdmin as unknown as SupabaseClient;

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

type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  md5Checksum?: string;
};

/**
 * Gmail sync (Phase 0)
 */
export const processGmailConnection = inngest.createFunction(
  { id: 'process-gmail-connection', name: 'Process Gmail Connection', retries: 3 },
  { event: 'gmail/connection.established' },
  async ({ event, step }) => {
    const { userId, connectionId } = event.data as { userId: string; connectionId?: string };
    const nangoConnectionId = connectionId || userId;

    try {
    await step.run('update-status-fetching', async () => {
        const { error } = await supa
        .from('sync_status')
          .upsert(
            {
          user_id: userId,
          status: 'fetching',
              current_provider: 'gmail',
          updated_at: new Date().toISOString(),
              error_message: null,
            },
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
        const { error } = await supa
        .from('sync_status')
          .upsert(
            {
          user_id: userId,
          status: 'securing',
              current_provider: 'gmail',
          updated_at: new Date().toISOString(),
              error_message: null,
            },
            { onConflict: 'user_id' }
          );
        if (error) throw error;
      });

      await step.run('nightfall-dlp-scan', async () => {
        // Scan and tokenize the fields we will store
        for (const email of emails) {
          const scanned = await scanContent(`${email.from}\n${email.subject}`);
          await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });

          // Replace stored fields with tokenized versions
          const [fromLine, ...subjectLines] = scanned.redacted.split('\n');
          email.from = fromLine || email.from;
          email.subject = subjectLines.join('\n') || email.subject;
        }
      });

    await step.run('persist-emails', async () => {
        const { error: deleteError } = await supa.from('emails').delete().eq('user_id', userId);
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

          const { error: insertError } = await supa.from('emails').insert(rows);
          if (insertError) throw insertError;
        }
      });

      await step.run('update-status-complete', async () => {
        const { error } = await supa
          .from('sync_status')
          .upsert(
            {
              user_id: userId,
              status: 'complete',
              current_provider: null,
              updated_at: new Date().toISOString(),
              error_message: null,
            },
            { onConflict: 'user_id' }
          );
        if (error) throw error;
      });

      await step.run('update-connection-last-sync-gmail', async () => {
        // Best-effort: reflect successful sync for UI status
        await supa
          .from('connections')
          .update({ last_sync_at: new Date().toISOString(), status: 'connected' })
          .eq('user_id', userId)
          .eq('provider', 'gmail');
      });

      return {
        success: true,
        userId,
        emailsProcessed: emails.length,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await step.run('update-status-error', async () => {
        const { error } = await supa
          .from('sync_status')
          .upsert(
            {
              user_id: userId,
              status: 'error',
              current_provider: 'gmail',
              error_message: message,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );
        if (error) console.error('Failed to update sync_status error', error);
      });
      throw err;
    }
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
      const { error } = await supa
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
      const { error } = await supa
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

    await step.run('nightfall-dlp-scan-calendar', async () => {
      for (const ev of events) {
        const scanned = await scanContent(`${ev.title}\n${ev.location || ''}`);
        await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });
        const [titleLine, ...locLines] = scanned.redacted.split('\n');
        ev.title = titleLine || ev.title;
        const loc = locLines.join('\n').trim();
        ev.location = loc || ev.location;
      }
    });

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

        const { error: upsertError } = await supa
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
        const { error } = await supa
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
      const { error } = await supa
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

    await step.run('update-connection-last-sync-calendar', async () => {
      await supa
        .from('connections')
        .update({ last_sync_at: new Date().toISOString(), status: 'connected' })
        .eq('user_id', userId)
        .eq('provider', 'calendar');
    });

    // Emit an event for downstream analysis pipeline (Time Sovereignty)
    await step.run('emit-calendar-events-synced', async () => {
      await inngest.send({
        name: 'calendar/events.synced',
        data: { userId, timestamp: new Date().toISOString() },
      });
    });

    return {
      success: true,
      userId,
      eventsProcessed: events.length,
      timestamp: new Date().toISOString(),
    };
  }
);

/**
 * Time Sovereignty: analyze calendar (event-triggered)
 */
export const analyzeCalendar = inngest.createFunction(
  { id: 'analyze-calendar', name: 'Analyze Calendar', retries: 2 },
  { event: 'calendar/events.synced' },
  async ({ event, step }) => {
    const { userId } = event.data as { userId: string };
    const result = await step.run('run-calendar-analysis', async () => runCalendarAnalysisForUser({ userId }));
    return { ...result, timestamp: new Date().toISOString() };
  }
);

/**
 * Time Sovereignty: cron fan-out every 30 minutes
 */
export const analyzeCalendarCron = inngest.createFunction(
  { id: 'analyze-calendar-cron', name: 'Analyze Calendar (Cron)', retries: 1 },
  { cron: '*/30 * * * *' },
  async ({ step }) => {
    const userIds = await step.run('list-calendar-users', async () => {
      const { data, error } = await supa
        .from('connections')
        .select('user_id')
        .eq('provider', 'calendar')
        .eq('status', 'connected')
        .limit(2000);
      if (error) throw error;
      return Array.from(new Set((data || []).map((r) => String((r as { user_id?: unknown }).user_id || '')))).filter(
        Boolean
      );
    });

    if (userIds.length === 0) return { success: true, queued: 0 };

    await step.run('enqueue-calendar-analysis', async () => {
      await inngest.send(
        userIds.map((userId) => ({
          name: 'calendar/events.synced',
          data: { userId, timestamp: new Date().toISOString(), cron: true },
        }))
      );
    });

    return { success: true, queued: userIds.length };
  }
);

/**
 * Drive sync (Phase 1)
 */
export const syncDriveDocuments = inngest.createFunction(
  { id: 'sync-drive-documents', name: 'Sync Drive Documents', retries: 3 },
  { event: 'drive/connection.established' },
  async ({ event, step }) => {
    const { userId, connectionId } = event.data;
    const nangoConnectionId = connectionId || userId;

    await step.run('update-status-fetching-drive', async () => {
      const { error } = await supa
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'fetching',
            current_provider: 'drive',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      if (error) throw error;
    });

    const files = await step.run('fetch-drive-files', async () => {
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      const response = await nango.proxy({
        connectionId: nangoConnectionId,
        providerConfigKey: 'google-drive',
        method: 'GET',
        endpoint: '/drive/v3/files',
        params: {
          q: `modifiedTime > '${since}' and trashed = false`,
          pageSize: '50',
          fields: 'files(id,name,mimeType,modifiedTime,webViewLink,parents,md5Checksum)',
        },
      });

      const items: GoogleDriveFile[] = response.data?.files || [];
      return items;
    });

    await step.run('update-status-securing-drive', async () => {
      const { error } = await supa
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'securing',
            current_provider: 'drive',
          updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      if (error) throw error;
    });

    await step.run('nightfall-dlp-scan-drive', async () => {
      for (const f of files) {
        const scanned = await scanContent(f.name);
        await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });
        f.name = scanned.redacted;
      }
    });

    await step.run('persist-drive-documents', async () => {
      const rows = files.map((f) => ({
        user_id: userId,
        document_id: f.id,
        name: f.name,
        mime_type: f.mimeType || 'application/octet-stream',
        folder_path: f.parents?.[0] || null,
        modified_at: f.modifiedTime || null,
        web_view_link: f.webViewLink || null,
        content_hash: f.md5Checksum || null,
        is_context_folder: false,
      }));

      if (rows.length > 0) {
        const { error } = await supa
          .from('drive_documents')
          .upsert(rows, { onConflict: 'user_id,document_id' });
        if (error) throw error;
      }
    });

    await step.run('update-status-complete-drive', async () => {
      const { error } = await supa
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

    await step.run('update-connection-last-sync-drive', async () => {
      await supa
        .from('connections')
        .update({ last_sync_at: new Date().toISOString(), status: 'connected' })
        .eq('user_id', userId)
        .eq('provider', 'drive');
    });

    return { 
      success: true,
      userId,
      documentsProcessed: files.length,
      timestamp: new Date().toISOString(),
    };
  }
);

/**
 * Strategic Clarity: generate daily briefing (manual trigger)
 */
export const generateDailyBriefing = inngest.createFunction(
  { id: 'generate-daily-briefing', name: 'Generate Daily Briefing', retries: 2 },
  { event: 'briefing/generate.requested' },
  async ({ event, step }) => {
    const { userId, date } = event.data as { userId: string; date?: string };
    await step.run('generate-briefing', async () => generateBriefingForUser({ userId, date }));
    return { success: true, userId, date: date || new Date().toISOString().slice(0, 10) };
  }
);

/**
 * Strategic Clarity: cron fan-out (6 AM UTC)
 */
export const generateDailyBriefingsCron = inngest.createFunction(
  { id: 'generate-daily-briefings-cron', name: 'Generate Daily Briefings (Cron)', retries: 1 },
  { cron: '0 6 * * *' },
  async ({ step }) => {
    const userIds = await step.run('list-users', async () => listBriefingUserIds());
    if (userIds.length === 0) return { success: true, queued: 0 };

    await step.run('enqueue', async () => {
      await inngest.send(
        userIds.map((userId) => ({
          name: 'briefing/generate.requested',
          data: { userId, date: new Date().toISOString().slice(0, 10) },
        }))
      );
    });
    return { success: true, queued: userIds.length };
  }
);

// Export all functions
export const functions = [
  processGmailConnection,
  syncCalendarEvents,
  syncDriveDocuments,
  generateDailyBriefing,
  generateDailyBriefingsCron,
  analyzeCalendar,
  analyzeCalendarCron,
];
