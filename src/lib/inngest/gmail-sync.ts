/**
 * EmergentOS - Gmail Sync Inngest Function
 * 
 * Implements processGmailSync per Section 7.1.
 */

import { inngest } from '../inngest';
import { supabase } from '../supabase';
import { nango, PROVIDER_CONFIG_KEYS } from '../nango';
import { daysAgoUTC, toUnixSeconds } from '../time';
import { decodeHtmlEntities } from '../helpers';
import { classifyError, formatErrorMessage } from '../errors';
import { generateAndStoreEmbeddings, prepareEmailEmbeddings } from '../embeddings';
import { GMAIL_INITIAL_DAYS } from '../constants';

// ============================================================================
// Types
// ============================================================================

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    parts?: Array<{ mimeType: string; filename?: string }>;
  };
  internalDate: string;
}

interface ParsedEmail {
  message_id: string;
  thread_id: string | null;
  sender: string;
  subject: string;
  snippet: string | null;
  received_at: string;
  is_read: boolean;
  has_attachments: boolean;
  labels: string[];
  security_verified: boolean;
}

// ============================================================================
// Gmail Sync Function
// ============================================================================

export const processGmailSync = inngest.createFunction(
  { 
    id: 'process-gmail-sync',
    name: 'Process Gmail Sync',
    retries: 3,
  },
  { event: 'gmail/sync.requested' },
  async ({ event, step }) => {
    const { userId, connectionId, trigger, idempotencyKey, jobId } = event.data;

    console.log(`[Gmail Sync] Starting for user ${userId}, trigger: ${trigger}, jobId: ${jobId}`);

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
      console.log(`[Gmail Sync] Job already completed with idempotency key: ${idempotencyKey}`);
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

    // STEP 4: DETERMINE SYNC TYPE
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

    const lastSyncAt = connection.last_sync_at;
    const isInitialSync = !lastSyncAt;
    const afterDate = isInitialSync
      ? daysAgoUTC(GMAIL_INITIAL_DAYS)
      : new Date(lastSyncAt);

    console.log(`[Gmail Sync] Sync type: ${isInitialSync ? 'initial' : 'delta'}, after: ${afterDate.toISOString()}`);

    // STEP 5: FETCH ALL MESSAGE IDS (PAGINATED)
    const allMessageIds = await step.run('fetch-message-ids', async () => {
      const query = `in:inbox after:${toUnixSeconds(afterDate)}`;
      const messageIds: string[] = [];
      let pageToken: string | null = null;
      const nangoConnectionId = connection.connection_id;

      try {
        do {
          const params: Record<string, string | number> = {
            q: query,
            maxResults: 500,
          };
          if (pageToken) {
            params.pageToken = pageToken;
          }

          const response = await nango.proxy({
            method: 'GET',
            endpoint: '/gmail/v1/users/me/messages',
            providerConfigKey: PROVIDER_CONFIG_KEYS.gmail,
            connectionId: nangoConnectionId,
            params,
          });

          const messages = response.data?.messages || [];
          messageIds.push(...messages.map((m: { id: string }) => m.id));
          pageToken = response.data?.nextPageToken || null;

          console.log(`[Gmail Sync] Fetched ${messages.length} message IDs, total: ${messageIds.length}`);
        } while (pageToken);

        return messageIds;
      } catch (error) {
        const classified = classifyError(error);
        if (classified.action === 'reconnect') {
          // Mark connection as error
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

    console.log(`[Gmail Sync] Total message IDs to process: ${allMessageIds.length}`);

    // STEP 6: FETCH FULL DETAILS (in batches to avoid timeout)
    const parsedEmails = await step.run('fetch-message-details', async () => {
      const emails: ParsedEmail[] = [];
      const nangoConnectionId = connection.connection_id;
      const batchSize = 50; // Process in smaller batches

      for (let i = 0; i < allMessageIds.length; i += batchSize) {
        const batch = allMessageIds.slice(i, i + batchSize);
        
        const batchResults = await Promise.all(
          batch.map(async (messageId) => {
            try {
              const response = await nango.proxy({
                method: 'GET',
                endpoint: `/gmail/v1/users/me/messages/${messageId}`,
                providerConfigKey: PROVIDER_CONFIG_KEYS.gmail,
                connectionId: nangoConnectionId,
                params: { format: 'full' },
              });

              return parseGmailMessage(response.data);
            } catch (error) {
              console.error(`[Gmail Sync] Failed to fetch message ${messageId}:`, error);
              return null;
            }
          })
        );

        emails.push(...batchResults.filter((e): e is ParsedEmail => e !== null));
        
        console.log(`[Gmail Sync] Processed ${Math.min(i + batchSize, allMessageIds.length)}/${allMessageIds.length} messages`);
      }

      return emails;
    });

    console.log(`[Gmail Sync] Parsed ${parsedEmails.length} emails`);

    // STEP 7-8: UPDATE STATUS → 'securing' (DLP placeholder)
    await step.run('update-status-securing', async () => {
      await supabase
        .from('sync_jobs')
        .update({ status: 'securing' })
        .eq('id', jobId);
      
      // DLP scan would go here - for now, mark all as verified
      // Nightfall integration can be added later
    });

    // STEP 9: UPDATE STATUS → 'persisting'
    await step.run('update-status-persisting', async () => {
      await supabase
        .from('sync_jobs')
        .update({ status: 'persisting' })
        .eq('id', jobId);
    });

    // STEP 10-12: COUNT BEFORE, PERSIST, COUNT AFTER
    const { itemsInserted, dataChanged } = await step.run('persist-emails', async () => {
      // Count before
      const { count: beforeCount } = await supabase
        .from('emails')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      // Add user_id to each email and UPSERT
      const emailsWithUser = parsedEmails.map((e) => ({
        ...e,
        user_id: userId,
        security_verified: true, // DLP placeholder
      }));

      if (emailsWithUser.length > 0) {
        // UPSERT in batches
        const upsertBatchSize = 100;
        for (let i = 0; i < emailsWithUser.length; i += upsertBatchSize) {
          const batch = emailsWithUser.slice(i, i + upsertBatchSize);
          const { error } = await supabase
            .from('emails')
            .upsert(batch, { onConflict: 'user_id,message_id' });

          if (error) {
            console.error('[Gmail Sync] UPSERT error:', error);
          }
        }
      }

      // Count after
      const { count: afterCount } = await supabase
        .from('emails')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      const inserted = Math.max(0, (afterCount || 0) - (beforeCount || 0));
      
      return {
        itemsInserted: inserted,
        dataChanged: inserted > 0,
      };
    });

    console.log(`[Gmail Sync] Items inserted: ${itemsInserted}, dataChanged: ${dataChanged}`);

    // STEP 13: CONDITIONAL EMBEDDING GENERATION
    const embeddingResult = await step.run('generate-embeddings', async () => {
      // Update status
      await supabase
        .from('sync_jobs')
        .update({ status: 'embedding' })
        .eq('id', jobId);

      // Skip if auto-sync with no data changes
      if (trigger === 'auto' && !dataChanged) {
        console.log('[Gmail Sync] Skipping embeddings - no data changes on auto-sync');
        return { inserted: 0, skipped: 0 };
      }

      // Fetch ALL emails for user to embed
      const { data: allEmails } = await supabase
        .from('emails')
        .select('message_id, sender, subject, snippet, received_at')
        .eq('user_id', userId);

      if (!allEmails || allEmails.length === 0) {
        return { inserted: 0, skipped: 0 };
      }

      const inputs = prepareEmailEmbeddings(allEmails);
      return generateAndStoreEmbeddings(userId, inputs);
    });

    console.log(`[Gmail Sync] Embeddings - inserted: ${embeddingResult.inserted}, skipped: ${embeddingResult.skipped}`);

    // STEP 14: UPDATE CONNECTION last_sync_at
    await step.run('update-connection', async () => {
      await supabase
        .from('connections')
        .update({
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', connectionId);
    });

    // STEP 15: MARK JOB COMPLETE
    await step.run('complete-job', async () => {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'complete',
          items_fetched: allMessageIds.length,
          items_inserted: itemsInserted,
          items_deleted: 0,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    });

    console.log(`[Gmail Sync] Completed for user ${userId}`);

    return {
      success: true,
      itemsFetched: allMessageIds.length,
      itemsInserted,
      dataChanged,
      embeddingsInserted: embeddingResult.inserted,
    };
  }
);

// ============================================================================
// Helper Functions
// ============================================================================

function parseGmailMessage(message: GmailMessage): ParsedEmail {
  const headers = message.payload?.headers || [];
  
  const getHeader = (name: string): string => {
    const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
    return header?.value || '';
  };

  const from = decodeHtmlEntities(getHeader('From'));
  const subject = decodeHtmlEntities(getHeader('Subject'));
  const dateHeader = getHeader('Date');

  // Parse date
  let receivedAt: string;
  try {
    receivedAt = new Date(dateHeader).toISOString();
  } catch {
    // Fallback to internal date (epoch milliseconds)
    receivedAt = new Date(parseInt(message.internalDate, 10)).toISOString();
  }

  // Check for attachments
  const hasAttachments = message.payload?.parts?.some(
    (part) => part.filename && part.filename.length > 0
  ) || false;

  // Check read status
  const isRead = !message.labelIds?.includes('UNREAD');

  return {
    message_id: message.id,
    thread_id: message.threadId || null,
    sender: from,
    subject: subject || '(No subject)',
    snippet: decodeHtmlEntities(message.snippet || ''),
    received_at: receivedAt,
    is_read: isRead,
    has_attachments: hasAttachments,
    labels: message.labelIds || [],
    security_verified: false,
  };
}
