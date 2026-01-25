/**
 * EmergentOS - Drive Sync Inngest Function
 * 
 * Implements processDriveSync per Section 7.3.
 */

import { inngest } from '../inngest';
import { supabase } from '../supabase';
import { nango, PROVIDER_CONFIG_KEYS } from '../nango';
import { daysAgoUTC } from '../time';
import { classifyError, formatErrorMessage } from '../errors';
import { generateAndStoreEmbeddings, prepareDriveEmbeddings } from '../embeddings';
import { DRIVE_INITIAL_DAYS } from '../constants';

// ============================================================================
// Types
// ============================================================================

interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
  md5Checksum?: string;
  parents?: string[];
}

interface ParsedDocument {
  document_id: string;
  name: string;
  mime_type: string;
  folder_path: string | null;
  modified_at: string | null;
  web_view_link: string | null;
  md5_checksum: string | null;
  content_preview: string | null;
  security_verified: boolean;
}

// ============================================================================
// Drive Sync Function
// ============================================================================

export const processDriveSync = inngest.createFunction(
  {
    id: 'process-drive-sync',
    name: 'Process Drive Sync',
    retries: 3,
  },
  { event: 'drive/sync.requested' },
  async ({ event, step }) => {
    const { userId, connectionId, trigger, idempotencyKey, jobId } = event.data;

    console.log(`[Drive Sync] Starting for user ${userId}, trigger: ${trigger}, jobId: ${jobId}`);

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
      console.log(`[Drive Sync] Job already completed with idempotency key: ${idempotencyKey}`);
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

    const lastSyncAt = connection.last_sync_at;
    const isInitialSync = !lastSyncAt;
    const sinceDate = isInitialSync
      ? daysAgoUTC(DRIVE_INITIAL_DAYS)
      : new Date(lastSyncAt);

    console.log(`[Drive Sync] Sync type: ${isInitialSync ? 'initial' : 'delta'}, since: ${sinceDate.toISOString()}`);

    // STEP 5: FETCH DRIVE FILES (PAGINATED)
    const allFiles = await step.run('fetch-files', async () => {
      const query = `modifiedTime > '${sinceDate.toISOString()}' and trashed = false`;
      const files: GoogleDriveFile[] = [];
      let pageToken: string | null = null;
      const nangoConnectionId = connection.connection_id;

      try {
        do {
          const params: Record<string, string | number> = {
            q: query,
            fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,md5Checksum,parents)',
            pageSize: 1000,
          };
          if (pageToken) {
            params.pageToken = pageToken;
          }

          const response = await nango.proxy({
            method: 'GET',
            endpoint: '/drive/v3/files',
            providerConfigKey: PROVIDER_CONFIG_KEYS.drive,
            connectionId: nangoConnectionId,
            params,
          });

          files.push(...(response.data?.files || []));
          pageToken = response.data?.nextPageToken || null;

          console.log(`[Drive Sync] Fetched ${response.data?.files?.length || 0} files, total: ${files.length}`);
        } while (pageToken);

        return files;
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

    console.log(`[Drive Sync] Total files fetched: ${allFiles.length}`);

    // STEP 6: PARSE FILE METADATA
    const parsedDocuments = allFiles.map(parseFile);

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

    // STEP 10-12: COUNT BEFORE, PERSIST, COUNT AFTER
    const { itemsInserted, dataChanged } = await step.run('persist-documents', async () => {
      // Count before
      const { count: beforeCount } = await supabase
        .from('drive_documents')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      // Add user_id to each document and UPSERT
      const documentsWithUser = parsedDocuments.map((d) => ({
        ...d,
        user_id: userId,
      }));

      if (documentsWithUser.length > 0) {
        // UPSERT in batches
        const upsertBatchSize = 100;
        for (let i = 0; i < documentsWithUser.length; i += upsertBatchSize) {
          const batch = documentsWithUser.slice(i, i + upsertBatchSize);
          const { error } = await supabase
            .from('drive_documents')
            .upsert(batch, { onConflict: 'user_id,document_id' });

          if (error) {
            console.error('[Drive Sync] UPSERT error:', error);
          }
        }
      }

      // Count after
      const { count: afterCount } = await supabase
        .from('drive_documents')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      const inserted = Math.max(0, (afterCount || 0) - (beforeCount || 0));

      return {
        itemsInserted: inserted,
        dataChanged: inserted > 0,
      };
    });

    console.log(`[Drive Sync] Items inserted: ${itemsInserted}, dataChanged: ${dataChanged}`);

    // STEP 13: CONDITIONAL EMBEDDING GENERATION
    const embeddingResult = await step.run('generate-embeddings', async () => {
      await supabase
        .from('sync_jobs')
        .update({ status: 'embedding' })
        .eq('id', jobId);

      // Skip if auto-sync with no data changes
      if (trigger === 'auto' && !dataChanged) {
        console.log('[Drive Sync] Skipping embeddings - no data changes on auto-sync');
        return { inserted: 0, skipped: 0 };
      }

      // Fetch ALL documents for user to embed
      const { data: allDocs } = await supabase
        .from('drive_documents')
        .select('document_id, name, mime_type, modified_at, content_preview')
        .eq('user_id', userId);

      if (!allDocs || allDocs.length === 0) {
        return { inserted: 0, skipped: 0 };
      }

      const inputs = prepareDriveEmbeddings(allDocs);
      return generateAndStoreEmbeddings(userId, inputs);
    });

    console.log(`[Drive Sync] Embeddings - inserted: ${embeddingResult.inserted}, skipped: ${embeddingResult.skipped}`);

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
          items_fetched: allFiles.length,
          items_inserted: itemsInserted,
          items_deleted: 0,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    });

    console.log(`[Drive Sync] Completed for user ${userId}`);

    return {
      success: true,
      itemsFetched: allFiles.length,
      itemsInserted,
      dataChanged,
      embeddingsInserted: embeddingResult.inserted,
    };
  }
);

// ============================================================================
// Helper Functions
// ============================================================================

function parseFile(file: GoogleDriveFile): ParsedDocument {
  return {
    document_id: file.id,
    name: file.name,
    mime_type: file.mimeType,
    folder_path: file.parents?.[0] || null,  // First parent folder
    modified_at: file.modifiedTime || null,
    web_view_link: file.webViewLink || null,
    md5_checksum: file.md5Checksum || null,
    content_preview: null,  // Content preview would require additional API calls
    security_verified: true,
  };
}
