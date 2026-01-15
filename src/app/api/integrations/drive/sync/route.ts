import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { inngest } from '@/lib/inngest';
import { supabaseAdmin } from '@/lib/supabase-server';
import { Nango } from '@nangohq/node';
import type { SupabaseClient } from '@supabase/supabase-js';

type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  md5Checksum?: string;
};

export async function POST() {
  try {
    const { userId } = await auth();
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
      return NextResponse.json({
        success: true,
        documentsSynced: 0,
        warning: 'Nango not configured on server. Set NANGO_SECRET_KEY and reconnect Drive.',
      });
    }

    const nango = new Nango({ secretKey: nangoSecretKey });
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const response = await nango.proxy({
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

    const files: GoogleDriveFile[] = response.data?.files || [];
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
      const { error } = await supa.from('drive_documents').upsert(rows, { onConflict: 'user_id,document_id' });
      if (error) console.error('Drive upsert error', error);
    }

    return NextResponse.json({ success: true, documentsSynced: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Drive sync trigger failed', error);
    return NextResponse.json({ error: 'Failed to trigger drive sync', details: message }, { status: 500 });
  }
}

