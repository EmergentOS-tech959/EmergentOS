import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { Nango } from '@nangohq/node';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';

type GoogleDriveFolder = {
  id: string;
  name: string;
};

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const nangoSecretKey = process.env.NANGO_SECRET_KEY;
  if (!nangoSecretKey) {
    return NextResponse.json({ folders: [], warning: 'Nango not configured' });
  }

  const supa = supabaseAdmin as unknown as SupabaseClient;

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
  if (!connectionId) return NextResponse.json({ folders: [], warning: 'Drive not connected' });

  const nango = new Nango({ secretKey: nangoSecretKey });

  const response = await nango.proxy({
    connectionId: String(connectionId),
    providerConfigKey: 'google-drive',
    method: 'GET',
    endpoint: '/drive/v3/files',
    params: {
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      pageSize: '100',
      fields: 'files(id,name)',
    },
  });

  const files = (response.data?.files || []) as unknown[];
  const folders: GoogleDriveFolder[] = files.map((f) => {
    const file = f as { id?: unknown; name?: unknown };
    return {
      id: String(file.id ?? ''),
      name: String(file.name ?? ''),
    };
  });

  return NextResponse.json({ folders });
}

