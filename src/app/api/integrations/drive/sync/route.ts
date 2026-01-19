import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { inngest } from '@/lib/inngest';
import { supabaseAdmin } from '@/lib/supabase-server';
import { Nango } from '@nangohq/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { scanContent } from '@/lib/nightfall';
import { upsertPiiVaultTokens } from '@/lib/pii-vault';

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

export async function POST() {
  let authedUserId: string | null = null;
  try {
    const { userId } = await auth();
    authedUserId = userId || null;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supa = supabaseAdmin as unknown as SupabaseClient;

    // Find connectionId by Clerk userId (and legacy metadata mapping)
    const { data: direct } = await supa
      .from('connections')
      .select('connection_id')
      .eq('user_id', userId)
      .eq('provider', 'drive')
      .maybeSingle();

    const directId = (direct as { connection_id?: string } | null)?.connection_id;
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
        warning: 'Drive not connected. Please connect Google Drive first.',
      });
    }

    // Drive status transitions for UI (do not depend on Inngest running)
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
        timestamp: new Date().toISOString(),
      },
    });

    // Direct sync for immediate UI feedback
    const nangoSecretKey = process.env.NANGO_SECRET_KEY;
    if (!nangoSecretKey) {
      await supa
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'error',
            current_provider: 'drive',
            error_message: 'Nango not configured on server',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      return NextResponse.json({
        success: true,
        documentsSynced: 0,
        warning: 'Nango not configured on server. Set NANGO_SECRET_KEY and reconnect Drive.',
      });
    }

    const nango = new Nango({ secretKey: nangoSecretKey });
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    let response;
    try {
      response = await nango.proxy({
        connectionId: String(connectionId),
        providerConfigKey: 'google-drive',
        method: 'GET',
        endpoint: '/drive/v3/files',
        params: {
          q: `modifiedTime > '${since}' and trashed = false`,
          pageSize: '50',
          fields: 'files(id,name,mimeType,modifiedTime,webViewLink,parents,md5Checksum)',
        },
      });
    } catch (nangoError) {
      console.error('Nango drive sync failed', nangoError);
      await supa
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'error',
            current_provider: 'drive',
            error_message: 'Drive sync could not reach Nango',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      return NextResponse.json({
        success: true,
        documentsSynced: 0,
        warning: 'Drive sync could not reach Nango. Ensure the Drive connection is active.',
      });
    }

    const parsed = parseProxyData(response.data) as { files?: unknown[] } | string | undefined;
    const files: GoogleDriveFile[] =
      typeof parsed === 'object' && parsed && Array.isArray(parsed.files) ? (parsed.files as GoogleDriveFile[]) : [];
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
      const dlpIssue = getDlpConfigIssue();
      if (dlpIssue) {
        await supa
          .from('sync_status')
          .upsert(
            {
              user_id: userId,
              status: 'error',
              current_provider: 'drive',
              error_message: dlpIssue,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );
        return NextResponse.json({
          success: true,
          documentsSynced: 0,
          warning: dlpIssue,
        });
      }

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

      // Nightfall DLP gate before storage
      try {
        for (const r of rows) {
          const scanned = await scanContent(r.name);
          await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });
          r.name = scanned.redacted;
        }
      } catch (dlpError) {
        const details = dlpError instanceof Error ? dlpError.message : 'Unknown DLP error';
        console.error('Drive DLP gate failed', dlpError);
        await supa
          .from('sync_status')
          .upsert(
            {
              user_id: userId,
              status: 'error',
              current_provider: 'drive',
              error_message: `Drive DLP gate failed: ${details}`,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );
        return NextResponse.json({
          success: true,
          documentsSynced: 0,
          warning: `Drive data was NOT stored because DLP failed: ${details}`,
        });
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

    return NextResponse.json({ success: true, documentsSynced: rows.length });
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

