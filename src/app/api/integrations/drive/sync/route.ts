import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { inngest } from '@/lib/inngest';
import { supabaseAdmin } from '@/lib/supabase-server';
import { Nango } from '@nangohq/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { scanContent } from '@/lib/nightfall';
import { upsertPiiVaultTokens } from '@/lib/pii-vault';
import { DriveConfig } from '@/lib/config/data-scope';

type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  md5Checksum?: string;
};

function parseProxyData(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

function getDlpConfigIssue(): string | null {
  if (!process.env.NIGHTFALL_API_KEY) return 'Missing NIGHTFALL_API_KEY on server (DLP gate required)';
  const keyB64 = process.env.PII_VAULT_KEY_BASE64;
  if (!keyB64) return 'Missing PII_VAULT_KEY_BASE64 on server (PII vault encryption key required)';
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) return 'PII_VAULT_KEY_BASE64 must decode to 32 bytes (AES-256 key)';
  return null;
}

/**
 * Fetch ALL Drive files with pagination (no limit)
 */
async function fetchAllDriveFiles(
  nango: Nango,
  connectionId: string,
  modifiedSince: string,
  pageSize: number = 100
): Promise<GoogleDriveFile[]> {
  const allFiles: GoogleDriveFile[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const response = await nango.proxy({
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

    const parsed = parseProxyData(response.data) as { files?: unknown[]; nextPageToken?: string } | undefined;
    const files: GoogleDriveFile[] =
      typeof parsed === 'object' && parsed && Array.isArray(parsed.files)
        ? (parsed.files as GoogleDriveFile[])
        : [];

    allFiles.push(...files);
    pageToken = parsed?.nextPageToken;

  } while (pageToken);

  return allFiles;
}

export async function POST() {
  let authedUserId: string | null = null;
  try {
    const { userId } = await auth();
    authedUserId = userId || null;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supa = supabaseAdmin as unknown as SupabaseClient;

    // Find connectionId by Clerk userId
    const { data: direct } = await supa
      .from('connections')
      .select('connection_id, last_sync_at')
      .eq('user_id', userId)
      .eq('provider', 'drive')
      .maybeSingle();

    const directData = direct as { connection_id?: string; last_sync_at?: string } | null;
    const directId = directData?.connection_id;
    const lastSyncAt = directData?.last_sync_at ? new Date(directData.last_sync_at) : null;
    
    const { data: meta } = directId
      ? { data: null }
      : await supa
          .from('connections')
          .select('connection_id')
          .eq('provider', 'drive')
          .contains('metadata', { clerk_user_id: userId })
          .maybeSingle();

    const metaId = (meta as { connection_id?: string } | null)?.connection_id;
    const connectionId = directId || metaId;

    if (!connectionId) {
      return NextResponse.json({
        success: true,
        documentsSynced: 0,
        warning: 'Drive not connected.',
      });
    }

    await supa
      .from('sync_status')
      .upsert(
        {
          user_id: userId,
          status: 'fetching',
          current_provider: 'drive',
          error_message: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    // Fire async pipeline
    await inngest.send({
      name: 'drive/connection.established',
      data: {
        userId,
        connectionId,
        providerConfigKey: 'google-drive',
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
            current_provider: 'drive',
            error_message: 'Nango not configured',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      return NextResponse.json({
        success: true,
        documentsSynced: 0,
        warning: 'Nango not configured.',
      });
    }

    const nango = new Nango({ secretKey: nangoSecretKey });
    
    // ═══════════════════════════════════════════════════════════════════════
    // DRIVE SYNC - Determine INITIAL vs DELTA sync based on last_sync_at
    // ═══════════════════════════════════════════════════════════════════════
    
    const isInitialSync = !lastSyncAt;
    let since: string;
    let pageSize: number;
    
    if (isInitialSync) {
      // INITIAL SYNC: 14 days back
      const timeRange = DriveConfig.initialSync.getTimeRange();
      since = timeRange.from.toISOString();
      pageSize = DriveConfig.initialSync.pageSize;
      console.log(`[Drive Sync API] INITIAL SYNC - Since: ${since}`);
    } else {
      // DELTA SYNC: Since last sync
      const timeRange = DriveConfig.deltaSync.getTimeRange(lastSyncAt);
      since = timeRange.from.toISOString();
      pageSize = DriveConfig.deltaSync.pageSize;
      console.log(`[Drive Sync API] DELTA SYNC - Since: ${since}`);
    }

    let files: GoogleDriveFile[];
    try {
      // Fetch ALL files with pagination (no limit)
      files = await fetchAllDriveFiles(nango, String(connectionId), since, pageSize);
    } catch (nangoError) {
      console.error('Nango drive sync failed', nangoError);
      await supa
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'error',
            current_provider: 'drive',
            error_message: 'Drive sync failed',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      return NextResponse.json({
        success: true,
        documentsSynced: 0,
        warning: 'Drive sync failed.',
      });
    }

    console.log(`[Drive Sync API] Total files fetched: ${files.length}`);

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
      await supa
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'securing',
            current_provider: 'drive',
            error_message: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

      // DLP scan files - graceful fallback on failure (continue without redaction)
      const dlpIssue = getDlpConfigIssue();
      if (dlpIssue) {
        console.warn(`[Drive Sync] DLP not configured: ${dlpIssue}, continuing without redaction`);
      } else {
        try {
          for (const r of rows) {
            const scanned = await scanContent(r.name);
            await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });
            r.name = scanned.redacted;
          }
        } catch (dlpError) {
          // DLP failed (rate limit, etc.) - continue WITHOUT redaction
          // Better to sync unredacted data than fail entirely
          console.warn('[Drive Sync] DLP scan failed, continuing without redaction:', dlpError);
        }
      }

      const { error } = await supa.from('drive_documents').upsert(rows, { onConflict: 'user_id,document_id' });
      if (error) console.error('Drive upsert error', error);
    }

    await supa
      .from('connections')
      .update({ last_sync_at: new Date().toISOString(), status: 'connected' })
      .eq('user_id', userId)
      .eq('provider', 'drive');

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

    return NextResponse.json({ 
      success: true, 
      documentsSynced: rows.length,
      syncType: isInitialSync ? 'initial' : 'delta',
      dataChanged: rows.length > 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Drive sync trigger failed', error);
    if (authedUserId) {
      try {
        const supa = supabaseAdmin as unknown as SupabaseClient;
        await supa
          .from('sync_status')
          .upsert(
            {
              user_id: authedUserId,
              status: 'error',
              current_provider: 'drive',
              error_message: message,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );
      } catch {
        // best-effort
      }
    }
    return NextResponse.json({ error: 'Failed to trigger drive sync', details: message }, { status: 500 });
  }
}
