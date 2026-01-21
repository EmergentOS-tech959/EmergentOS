import { inngest } from './inngest';
import { Nango } from '@nangohq/node';
import { supabaseAdmin } from './supabase-server';
import { scanContentChunked } from './nightfall';
import { upsertPiiVaultTokens } from './pii-vault';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateBriefingForUser, listBriefingUserIds } from './briefing-generator';
import { runCalendarAnalysisForUser } from './calendar-analysis';
import {
  generateEmbeddings,
  buildEmailEmbeddingInputs,
  buildCalendarEmbeddingInputs,
  buildDriveEmbeddingInputs,
  buildBriefingEmbeddingInputs,
  type SourceType,
} from './embeddings';
import {
  GmailConfig,
  CalendarConfig,
  DriveConfig,
  type SyncResult,
} from './config/data-scope';

// Initialize Nango client
const nango = new Nango({ 
  secretKey: process.env.NANGO_SECRET_KEY!,
});

const supa = supabaseAdmin as unknown as SupabaseClient;

// ============================================================================
// Types
// ============================================================================

interface GmailHeader {
  name: string;
  value: string;
}

interface ParsedEmail {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string; // Email preview text from Gmail API
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

// ============================================================================
// PAGINATION HELPERS - Fetch ALL data, no limits
// ============================================================================

/**
 * Fetch ALL Gmail messages with pagination (no limit)
 * Loops through all pages using nextPageToken until all messages are fetched
 */
async function fetchAllGmailMessages(
  connectionId: string,
  query: string,
  pageSize: number = 100
): Promise<{ id: string }[]> {
  const allMessages: { id: string }[] = [];
  let pageToken: string | undefined = undefined;
  let pageCount = 0;

  do {
    const response: { data?: { messages?: { id: string }[]; nextPageToken?: string } } = await nango.proxy({
      connectionId,
      providerConfigKey: 'google-mail',
      method: 'GET',
      endpoint: '/gmail/v1/users/me/messages',
      params: {
        maxResults: String(pageSize),
        q: query,
        ...(pageToken && { pageToken }),
      },
    });

    const messages = response.data?.messages || [];
    allMessages.push(...messages);

    pageToken = response.data?.nextPageToken;
    pageCount++;

    console.log(`[Gmail Pagination] Page ${pageCount}: ${messages.length} messages, total: ${allMessages.length}`);
  } while (pageToken);

  return allMessages;
}

/**
 * Fetch ALL Calendar events with pagination (no limit)
 * Also captures syncToken for future delta syncs
 */
async function fetchAllCalendarEvents(
  connectionId: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
  pageSize: number = 100
): Promise<{ events: GoogleCalendarApiEvent[]; syncToken?: string }> {
  const allEvents: GoogleCalendarApiEvent[] = [];
  let pageToken: string | undefined = undefined;
  let syncToken: string | undefined = undefined;
  let pageCount = 0;

  do {
    const response: { data?: { items?: GoogleCalendarApiEvent[]; nextPageToken?: string; nextSyncToken?: string } } = await nango.proxy({
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

    const items: GoogleCalendarApiEvent[] = response.data?.items || [];
    allEvents.push(...items);

    pageToken = response.data?.nextPageToken;
    // Capture syncToken from the last page
    if (!pageToken) {
      syncToken = response.data?.nextSyncToken;
    }
    pageCount++;

    console.log(`[Calendar Pagination] Page ${pageCount}: ${items.length} events, total: ${allEvents.length}`);
  } while (pageToken);

  return { events: allEvents, syncToken };
}

/**
 * Fetch Calendar events using syncToken for delta sync
 */
async function fetchCalendarEventsWithSyncToken(
  connectionId: string,
  calendarId: string,
  existingSyncToken: string
): Promise<{ events: GoogleCalendarApiEvent[]; newSyncToken?: string; tokenInvalid?: boolean }> {
  try {
    const response: { data?: { items?: GoogleCalendarApiEvent[]; nextSyncToken?: string } } = await nango.proxy({
      connectionId,
      providerConfigKey: 'google-calendar',
      method: 'GET',
      endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      params: { syncToken: existingSyncToken },
    });

    const items: GoogleCalendarApiEvent[] = response.data?.items || [];
    const newSyncToken = response.data?.nextSyncToken;

    console.log(`[Calendar Delta] syncToken returned ${items.length} changed events`);
    return { events: items, newSyncToken };
  } catch (error: unknown) {
    // Check if syncToken is invalid (410 Gone)
    const err = error as { response?: { status?: number } };
    if (err.response?.status === 410) {
      console.log('[Calendar Delta] syncToken expired (410 Gone), will do full sync');
      return { events: [], tokenInvalid: true };
    }
    throw error;
  }
}

/**
 * Fetch ALL Drive files with pagination (no limit)
 */
async function fetchAllDriveFiles(
  connectionId: string,
  modifiedSince: string,
  pageSize: number = 100
): Promise<GoogleDriveFile[]> {
  const allFiles: GoogleDriveFile[] = [];
  let pageToken: string | undefined = undefined;
  let pageCount = 0;

  do {
    const response: { data?: { files?: GoogleDriveFile[]; nextPageToken?: string } } = await nango.proxy({
      connectionId,
      providerConfigKey: 'google-drive',
      method: 'GET',
      endpoint: '/drive/v3/files',
      params: {
        pageSize: String(pageSize),
        q: `modifiedTime > '${modifiedSince}' and trashed = false`,
        fields: 'files(id,name,mimeType,modifiedTime,webViewLink,parents,md5Checksum),nextPageToken',
        ...(pageToken && { pageToken }),
      },
    });

    const files: GoogleDriveFile[] = response.data?.files || [];
    allFiles.push(...files);

    pageToken = response.data?.nextPageToken;
    pageCount++;

    console.log(`[Drive Pagination] Page ${pageCount}: ${files.length} files, total: ${allFiles.length}`);
  } while (pageToken);

  return allFiles;
}

// ============================================================================
// Gmail sync with pagination and delta sync
// ============================================================================

export const processGmailConnection = inngest.createFunction(
  { id: 'process-gmail-connection', name: 'Process Gmail Connection', retries: 3 },
  { event: 'gmail/connection.established' },
  async ({ event, step }) => {
    const { userId, connectionId, trigger = 'connect' } = event.data as { 
      userId: string; 
      connectionId?: string;
      trigger?: 'connect' | 'manual' | 'auto';
    };
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

      const syncResult = await step.run('fetch-gmail-emails', async (): Promise<{ emails: ParsedEmail[]; result: SyncResult }> => {
        // ═══════════════════════════════════════════════════════════════════════
        // GMAIL SYNC - Determine INITIAL vs DELTA sync based on last_sync_at
        // ═══════════════════════════════════════════════════════════════════════
        
        // Get connection info to determine sync type
        const { data: conn } = await supa
          .from('connections')
          .select('last_sync_at')
          .eq('user_id', userId)
          .eq('provider', 'gmail')
          .maybeSingle();
        
        const lastSyncAt = conn?.last_sync_at ? new Date(conn.last_sync_at) : null;
        const isInitialSync = !lastSyncAt;
        
        // Build query based on sync type
        let query: string;
        let pageSize: number;
        
        if (isInitialSync) {
          // INITIAL SYNC: Full 7-day window
          query = GmailConfig.initialSync.getGmailQuery();
          pageSize = GmailConfig.initialSync.pageSize;
          console.log(`[Gmail] INITIAL SYNC - Query: ${query}`);
        } else {
          // DELTA SYNC: Since last sync
          query = GmailConfig.deltaSync.getGmailQuery(lastSyncAt);
          pageSize = GmailConfig.deltaSync.pageSize;
          console.log(`[Gmail] DELTA SYNC - Query: ${query}, Since: ${lastSyncAt.toISOString()}`);
        }
        
        // Fetch ALL messages with pagination (no limit)
        const messages = await fetchAllGmailMessages(nangoConnectionId, query, pageSize);
        
        console.log(`[Gmail Sync] Total messages fetched: ${messages.length}`);
        
        if (messages.length === 0) {
          return {
            emails: [],
            result: {
              provider: 'gmail',
              totalFetched: 0,
              inserted: 0,
              updated: 0,
              deleted: 0,
              dataChanged: false,
            },
          };
        }

        // Fetch details for ALL messages
        const emailDetails: ParsedEmail[] = await Promise.all(
          messages.map(async (msg: { id: string }) => {
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

            // Extract snippet (email preview) - Gmail provides this automatically
            const snippet = responseData?.snippet || '';

            return {
              id: msg.id,
              from: getHeader('From'),
              subject: getHeader('Subject'),
              date: getHeader('Date'),
              snippet: snippet,
            };
          })
        );

        console.log(`[Gmail Sync] Processed ${emailDetails.length} email details`);
        
        return {
          emails: emailDetails,
          result: {
            provider: 'gmail',
            totalFetched: emailDetails.length,
            inserted: emailDetails.length, // Will be refined after upsert
            updated: 0,
            deleted: 0,
            dataChanged: emailDetails.length > 0,
          },
        };
      });

      const { emails, result: gmailResult } = syncResult;

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
        if (emails.length === 0) return;

        // Prepare content for batched scanning: from + subject + snippet for each email
        const contents = emails.map(email => 
          `${email.from}\n${email.subject}\n${email.snippet}`
        );

        // Scan all emails in batches (20 per API call with retry logic)
        console.log(`[Gmail DLP] Scanning ${emails.length} emails in batches...`);
        const scanResults = await scanContentChunked(contents, 20);

        // Process results and update emails
        for (let i = 0; i < emails.length; i++) {
          const scanned = scanResults[i];
          await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });

          // Parse the redacted content back into from, subject, snippet
          const [fromLine, subjectLine, ...snippetLines] = scanned.redacted.split('\n');
          emails[i].from = fromLine || emails[i].from;
          emails[i].subject = subjectLine || emails[i].subject;
          emails[i].snippet = snippetLines.join('\n') || emails[i].snippet;
        }
        console.log(`[Gmail DLP] Scan complete for ${emails.length} emails`);
      });

      await step.run('persist-emails', async () => {
        // For delta sync, we upsert (don't delete existing)
        // For initial sync on connect, we could clear first but upsert is safer
        if (emails.length > 0) {
          const rows = emails.map((email: ParsedEmail) => {
            // Convert email header date format to ISO format for proper database queries
            // Email date format: "Tue, 20 Jan 2026 10:37:36 +0100"
            // Target format: "2026-01-20T09:37:36.000Z" (ISO)
            let receivedAt: string;
            try {
              const parsed = new Date(email.date);
              receivedAt = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
            } catch {
              receivedAt = new Date().toISOString();
            }
            
            return {
              user_id: userId,
              message_id: email.id,
              sender: email.from,
              subject: email.subject || 'No Subject',
              snippet: email.snippet || '', // Store email preview
              received_at: receivedAt,
              security_verified: true,
            };
          });

          const { error: upsertError } = await supa
            .from('emails')
            .upsert(rows, { onConflict: 'user_id,message_id' });
          if (upsertError) throw upsertError;
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
        await supa
          .from('connections')
          .update({ last_sync_at: new Date().toISOString(), status: 'connected' })
          .eq('user_id', userId)
          .eq('provider', 'gmail');
      });

      // Trigger background embedding generation
      await step.run('trigger-embedding-generation-gmail', async () => {
        if (process.env.OPENAI_API_KEY && emails.length > 0) {
          await inngest.send({
            name: 'embeddings/generate.requested',
            data: { userId, sourceType: 'email', timestamp: new Date().toISOString() },
          });
        }
      });

      // NOTE: Briefing generation is now handled ONLY by sync-manager
      // This prevents duplicate briefing generation when:
      // 1. Inngest processes initial data
      // 2. Client calls onProviderConnected → sync-manager generates briefing
      // By removing it here, sync-manager is the single source of truth for briefings.

      return {
        success: true,
        userId,
        emailsProcessed: emails.length,
        syncResult: gmailResult,
        trigger,
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

// ============================================================================
// Calendar sync with pagination, delta sync (syncToken), and change detection
// ============================================================================

export const syncCalendarEvents = inngest.createFunction(
  { id: 'sync-calendar-events', name: 'Sync Calendar Events', retries: 3 },
  { event: 'calendar/connection.established' },
  async ({ event, step }) => {
    const { userId, connectionId, trigger = 'connect' } = event.data as {
      userId: string;
      connectionId?: string;
      trigger?: 'connect' | 'manual' | 'auto';
    };
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

    const syncResult = await step.run('fetch-calendar-events', async (): Promise<{ events: ParsedCalendarEvent[]; result: SyncResult; newSyncToken?: string }> => {
      // ═══════════════════════════════════════════════════════════════════════
      // CALENDAR SYNC - Uses syncToken for delta sync
      // ═══════════════════════════════════════════════════════════════════════
      
      // Get connection info including syncToken
      const { data: conn } = await supa
        .from('connections')
        .select('last_sync_at, metadata')
        .eq('user_id', userId)
        .eq('provider', 'calendar')
        .maybeSingle();
      
      const connMetadata = (conn?.metadata || {}) as { syncToken?: string };
      const syncToken = connMetadata.syncToken;
      const isInitialSync = !syncToken;
      
      let rawEvents: GoogleCalendarApiEvent[];
      let newSyncToken: string | undefined;
      
      if (isInitialSync) {
        // INITIAL SYNC: Full time range with pagination
        const timeRange = CalendarConfig.initialSync.getTimeRange();
        const timeMin = timeRange.from.toISOString();
        const timeMax = timeRange.to.toISOString();
        
        console.log(`[Calendar] INITIAL SYNC - TimeMin: ${timeMin}, TimeMax: ${timeMax}`);
        
        const result = await fetchAllCalendarEvents(
          nangoConnectionId,
          'primary',
          timeMin,
          timeMax,
          CalendarConfig.initialSync.pageSize
        );
        
        rawEvents = result.events;
        newSyncToken = result.syncToken;
        
      } else {
        // DELTA SYNC: Use syncToken
        console.log(`[Calendar] DELTA SYNC with syncToken`);
        
        const result = await fetchCalendarEventsWithSyncToken(
          nangoConnectionId,
          'primary',
          syncToken
        );
        
        if (result.tokenInvalid) {
          // Token expired, do full sync
          console.log(`[Calendar] syncToken invalid, falling back to full sync`);
          const timeRange = CalendarConfig.deltaSync.fallbackTimeRange();
          const result2 = await fetchAllCalendarEvents(
            nangoConnectionId,
            'primary',
            timeRange.from.toISOString(),
            timeRange.to.toISOString(),
            CalendarConfig.deltaSync.pageSize
          );
          rawEvents = result2.events;
          newSyncToken = result2.syncToken;
        } else {
          rawEvents = result.events;
          newSyncToken = result.newSyncToken;
        }
      }
      
      console.log(`[Calendar Sync] Total events fetched: ${rawEvents.length}`);
      
      // Parse events
      const events = rawEvents.map((item) => {
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
      
      return {
        events,
        result: {
          provider: 'calendar',
          totalFetched: events.length,
          inserted: events.length, // Will be refined based on actual upsert
          updated: 0,
          deleted: 0,
          dataChanged: events.length > 0,
        },
        newSyncToken,
      };
    });

    const { events, result: calendarResult, newSyncToken } = syncResult;

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
      if (events.length === 0) return;

      // Prepare content for batched scanning
      const contents = events.map(ev => `${ev.title}\n${ev.location || ''}`);
      
      console.log(`[Calendar DLP] Scanning ${events.length} events in batches...`);
      const scanResults = await scanContentChunked(contents, 20);

      for (let i = 0; i < events.length; i++) {
        const scanned = scanResults[i];
        await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });
        const [titleLine, ...locLines] = scanned.redacted.split('\n');
        events[i].title = titleLine || events[i].title;
        const loc = locLines.join('\n').trim();
        events[i].location = loc || events[i].location;
      }
      console.log(`[Calendar DLP] Scan complete for ${events.length} events`);
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
      // Update last_sync_at AND store the new syncToken for delta sync
      const { data: existingConn } = await supa
        .from('connections')
        .select('metadata')
        .eq('user_id', userId)
        .eq('provider', 'calendar')
        .maybeSingle();
      
      const existingMetadata = (existingConn?.metadata || {}) as Record<string, unknown>;
      
      await supa
        .from('connections')
        .update({ 
          last_sync_at: new Date().toISOString(), 
          status: 'connected',
          metadata: newSyncToken 
            ? { ...existingMetadata, syncToken: newSyncToken }
            : existingMetadata,
        })
        .eq('user_id', userId)
        .eq('provider', 'calendar');
    });

    // Emit event for calendar analysis
    await step.run('emit-calendar-events-synced', async () => {
      await inngest.send({
        name: 'calendar/events.synced',
        data: { userId, timestamp: new Date().toISOString() },
      });
    });

    // Trigger background embedding generation
    await step.run('trigger-embedding-generation-calendar', async () => {
      if (process.env.OPENAI_API_KEY && events.length > 0) {
        await inngest.send({
          name: 'embeddings/generate.requested',
          data: { userId, sourceType: 'calendar', timestamp: new Date().toISOString() },
        });
      }
    });

    // NOTE: Briefing generation is now handled ONLY by sync-manager
    // This prevents duplicate briefing generation.

    return {
      success: true,
      userId,
      eventsProcessed: events.length,
      syncResult: calendarResult,
      trigger,
      timestamp: new Date().toISOString(),
    };
  }
);

// ============================================================================
// Time Sovereignty: analyze calendar (event-triggered)
// ============================================================================

export const analyzeCalendar = inngest.createFunction(
  { id: 'analyze-calendar', name: 'Analyze Calendar', retries: 2 },
  { event: 'calendar/events.synced' },
  async ({ event, step }) => {
    const { userId } = event.data as { userId: string };
    const result = await step.run('run-calendar-analysis', async () => runCalendarAnalysisForUser({ userId }));
    return { ...result, timestamp: new Date().toISOString() };
  }
);

// ============================================================================
// Time Sovereignty: cron fan-out every 30 minutes
// ============================================================================

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

// ============================================================================
// Drive sync with pagination and delta sync
// ============================================================================

export const syncDriveDocuments = inngest.createFunction(
  { id: 'sync-drive-documents', name: 'Sync Drive Documents', retries: 3 },
  { event: 'drive/connection.established' },
  async ({ event, step }) => {
    const { userId, connectionId, trigger = 'connect' } = event.data as {
      userId: string;
      connectionId?: string;
      trigger?: 'connect' | 'manual' | 'auto';
    };
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

    const syncResult = await step.run('fetch-drive-files', async (): Promise<{ files: GoogleDriveFile[]; result: SyncResult }> => {
      // ═══════════════════════════════════════════════════════════════════════
      // DRIVE SYNC - Determine INITIAL vs DELTA sync based on last_sync_at
      // ═══════════════════════════════════════════════════════════════════════
      
      // Get connection info to determine sync type
      const { data: conn } = await supa
        .from('connections')
        .select('last_sync_at')
        .eq('user_id', userId)
        .eq('provider', 'drive')
        .maybeSingle();
      
      const lastSyncAt = conn?.last_sync_at ? new Date(conn.last_sync_at) : null;
      const isInitialSync = !lastSyncAt;
      
      // Build query based on sync type
      let since: string;
      let pageSize: number;
      
      if (isInitialSync) {
        // INITIAL SYNC: 14 days back
        const timeRange = DriveConfig.initialSync.getTimeRange();
        since = timeRange.from.toISOString();
        pageSize = DriveConfig.initialSync.pageSize;
        console.log(`[Drive] INITIAL SYNC - Since: ${since}`);
      } else {
        // DELTA SYNC: Since last sync
        const timeRange = DriveConfig.deltaSync.getTimeRange(lastSyncAt);
        since = timeRange.from.toISOString();
        pageSize = DriveConfig.deltaSync.pageSize;
        console.log(`[Drive] DELTA SYNC - Since: ${since}`);
      }
      
      // Fetch ALL files with pagination (no limit)
      const files = await fetchAllDriveFiles(nangoConnectionId, since, pageSize);
      
      console.log(`[Drive Sync] Total files fetched: ${files.length}`);
      
      return {
        files,
        result: {
          provider: 'drive',
          totalFetched: files.length,
          inserted: files.length, // Will be refined after upsert
          updated: 0,
          deleted: 0,
          dataChanged: files.length > 0,
        },
      };
    });

    const { files, result: driveResult } = syncResult;

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
      if (files.length === 0) return;

      // Prepare content for batched scanning
      const contents = files.map(f => f.name);
      
      console.log(`[Drive DLP] Scanning ${files.length} files in batches...`);
      const scanResults = await scanContentChunked(contents, 20);

      for (let i = 0; i < files.length; i++) {
        const scanned = scanResults[i];
        await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });
        files[i].name = scanned.redacted;
      }
      console.log(`[Drive DLP] Scan complete for ${files.length} files`);
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

    // Trigger background embedding generation
    await step.run('trigger-embedding-generation-drive', async () => {
      if (process.env.OPENAI_API_KEY && files.length > 0) {
        await inngest.send({
          name: 'embeddings/generate.requested',
          data: { userId, sourceType: 'drive', timestamp: new Date().toISOString() },
        });
      }
    });

    // NOTE: Briefing generation is now handled ONLY by sync-manager
    // This prevents duplicate briefing generation.

    return { 
      success: true,
      userId,
      documentsProcessed: files.length,
      syncResult: driveResult,
      trigger,
      timestamp: new Date().toISOString(),
    };
  }
);

// ============================================================================
// Strategic Clarity: generate daily briefing (manual trigger)
// ============================================================================

export const generateDailyBriefing = inngest.createFunction(
  { id: 'generate-daily-briefing', name: 'Generate Daily Briefing', retries: 2 },
  { event: 'briefing/generate.requested' },
  async ({ event, step }) => {
    const { userId, date } = event.data as { userId: string; date?: string };
    await step.run('generate-briefing', async () => generateBriefingForUser({ userId, date }));
    
    // Trigger embedding generation for the new briefing
    await step.run('trigger-embedding-generation-briefing', async () => {
      if (process.env.OPENAI_API_KEY) {
        await inngest.send({
          name: 'embeddings/generate.requested',
          data: { userId, sourceType: 'briefing', timestamp: new Date().toISOString() },
        });
      }
    });

    return { success: true, userId, date: date || new Date().toISOString().slice(0, 10) };
  }
);

// ============================================================================
// Strategic Clarity: cron fan-out (6 AM UTC)
// ============================================================================

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

// ============================================================================
// Background embedding generation (triggered after sync)
// ============================================================================

export const generateEmbeddingsForUser = inngest.createFunction(
  { id: 'generate-embeddings', name: 'Generate Embeddings', retries: 2 },
  { event: 'embeddings/generate.requested' },
  async ({ event, step }) => {
    const { userId, sourceType, sourceIds } = event.data as {
      userId: string;
      sourceType?: SourceType;
      sourceIds?: string[];
    };

    // Check if OpenAI is configured
    if (!process.env.OPENAI_API_KEY) {
      console.log('OpenAI API key not configured, skipping embedding generation');
      return { success: true, skipped: true, reason: 'OPENAI_API_KEY not configured' };
    }

    const results: Record<string, { embedded: number; skipped: number; errors: string[] }> = {};

    // Generate embeddings based on source type or all types
    const typesToProcess: SourceType[] = sourceType 
      ? [sourceType] 
      : ['email', 'calendar', 'drive', 'briefing'];

    for (const type of typesToProcess) {
      const result = await step.run(`embed-${type}`, async () => {
        let inputs;

        switch (type) {
          case 'email': {
            const query = supa.from('emails').select('id, subject, sender, snippet, body_preview, received_at').eq('user_id', userId);
            const { data } = sourceIds 
              ? await query.in('id', sourceIds)
              : await query.order('received_at', { ascending: false }).limit(100);
            inputs = buildEmailEmbeddingInputs(data || []);
            break;
          }
          case 'calendar': {
            const query = supa.from('calendar_events').select('id, title, description, location, start_time, end_time, attendees').eq('user_id', userId);
            const { data } = sourceIds
              ? await query.in('id', sourceIds)
              : await query.order('start_time', { ascending: false }).limit(100);
            inputs = buildCalendarEmbeddingInputs(data || []);
            break;
          }
          case 'drive': {
            const query = supa.from('drive_documents').select('id, name, mime_type, folder_path, modified_at').eq('user_id', userId);
            const { data } = sourceIds
              ? await query.in('id', sourceIds)
              : await query.order('modified_at', { ascending: false }).limit(100);
            inputs = buildDriveEmbeddingInputs(data || []);
            break;
          }
          case 'briefing': {
            const query = supa.from('briefings').select('id, briefing_date, content, summary').eq('user_id', userId);
            const { data } = sourceIds
              ? await query.in('id', sourceIds)
              : await query.order('briefing_date', { ascending: false }).limit(14);
            inputs = buildBriefingEmbeddingInputs(data || []);
            break;
          }
        }

        if (!inputs || inputs.length === 0) {
          return { embedded: 0, skipped: 0, errors: [] as string[] };
        }

        return generateEmbeddings(userId, inputs);
      });

      results[type] = result as { embedded: number; skipped: number; errors: string[] };
    }

    return {
      success: true,
      userId,
      results,
      timestamp: new Date().toISOString(),
    };
  }
);

// ============================================================================
// Scheduled embedding refresh (every 10 minutes, generates for new items only)
// ============================================================================

export const generateEmbeddingsCron = inngest.createFunction(
  { id: 'generate-embeddings-cron', name: 'Generate Embeddings (Cron)', retries: 1 },
  { cron: '*/10 * * * *' },
  async ({ step }) => {
    if (!process.env.OPENAI_API_KEY) {
      return { success: true, skipped: true, reason: 'OPENAI_API_KEY not configured' };
    }

    // Get all users with connected sources
    const userIds = await step.run('list-users', async () => {
      const { data, error } = await supa
        .from('connections')
        .select('user_id')
        .eq('status', 'connected')
        .limit(2000);
      if (error) throw error;
      return Array.from(new Set((data || []).map((r) => String((r as { user_id?: unknown }).user_id || '')))).filter(Boolean);
    });

    if (userIds.length === 0) {
      return { success: true, queued: 0 };
    }

    // Queue embedding jobs for each user
    await step.run('enqueue-embeddings', async () => {
      await inngest.send(
        userIds.map((userId) => ({
          name: 'embeddings/generate.requested',
          data: { userId, timestamp: new Date().toISOString() },
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
  generateEmbeddingsForUser,
  generateEmbeddingsCron,
];
