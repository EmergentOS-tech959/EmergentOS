import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { inngest } from '@/lib/inngest';
import { supabaseAdmin } from '@/lib/supabase-server';
import { Nango } from '@nangohq/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { scanContentChunked } from '@/lib/nightfall';
import { upsertPiiVaultTokens } from '@/lib/pii-vault';
import { GmailConfig } from '@/lib/config/data-scope';

interface GmailHeader {
  name: string;
  value: string;
}

interface ParsedEmail {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
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
 * Fetch ALL Gmail messages with pagination (no limit)
 */
async function fetchAllGmailMessages(
  nango: Nango,
  connectionId: string,
  query: string,
  pageSize: number = 100
): Promise<{ id: string }[]> {
  const allMessages: { id: string }[] = [];
  let pageToken: string | undefined = undefined;

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
  } while (pageToken);

  return allMessages;
}

/**
 * POST /api/integrations/gmail/sync
 * Synchronous Gmail sync - fetches emails and waits for completion
 */
export async function POST() {
  let authedUserId: string | null = null;
  try {
    const { userId } = await auth();
    authedUserId = userId || null;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supa = supabaseAdmin as unknown as SupabaseClient;

    // Check DLP configuration
    const dlpIssue = getDlpConfigIssue();
    if (dlpIssue) {
      console.warn(`[Gmail Sync] DLP not configured: ${dlpIssue}`);
    }

    // Find connectionId by Clerk userId
    const { data: direct } = await supa
      .from('connections')
      .select('connection_id, last_sync_at')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .maybeSingle();

    const directData = direct as { connection_id?: string; last_sync_at?: string } | null;
    const directId = directData?.connection_id;
    const lastSyncAt = directData?.last_sync_at ? new Date(directData.last_sync_at) : null;

    const { data: meta } = directId
      ? { data: null }
      : await supa
          .from('connections')
          .select('connection_id, last_sync_at')
          .eq('provider', 'gmail')
          .contains('metadata', { clerk_user_id: userId })
          .maybeSingle();

    const metaData = meta as { connection_id?: string; last_sync_at?: string } | null;
    const connectionId = directId || metaData?.connection_id || null;
    const effectiveLastSyncAt = lastSyncAt || (metaData?.last_sync_at ? new Date(metaData.last_sync_at) : null);

    if (!connectionId) {
      return NextResponse.json({ 
        success: true, 
        warning: 'Gmail not connected',
        emailsProcessed: 0,
      });
    }

    // Update sync status
    await supa
      .from('sync_status')
      .upsert(
        {
          user_id: userId,
          status: 'fetching',
          current_provider: 'gmail',
          error_message: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    // Initialize Nango
    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

    // Determine time range for fetching
    // CRITICAL: Use data-scope config to ensure correct query (includes "in:inbox")
    const isInitialSync = !effectiveLastSyncAt;
    let query: string;

    if (isInitialSync) {
      // Initial sync: use configured day boundaries with "in:inbox" filter
      query = GmailConfig.initialSync.getGmailQuery();
      const { from: startDate } = GmailConfig.initialSync.getTimeRange();
      console.log(`[Gmail Sync] Initial sync from ${startDate.toISOString()}, query: ${query}`);
    } else {
      // Delta sync: use exact timestamp with "in:inbox" filter
      query = GmailConfig.deltaSync.getGmailQuery(effectiveLastSyncAt);
      console.log(`[Gmail Sync] Delta sync from ${effectiveLastSyncAt.toISOString()}, query: ${query}`);
    }

    // Fetch all messages
    console.log(`[Gmail Sync] Fetching messages with query: ${query}`);
    const messages = await fetchAllGmailMessages(nango, connectionId, query, GmailConfig.initialSync.pageSize);
    console.log(`[Gmail Sync] Found ${messages.length} messages`);

    if (messages.length === 0) {
      // No new messages - update last_sync_at and return
      const now = new Date().toISOString();
      await supa
        .from('connections')
        .update({ last_sync_at: now, status: 'connected' })
        .eq('user_id', userId)
        .eq('provider', 'gmail');

      await supa
        .from('sync_status')
        .upsert(
          {
            user_id: userId,
            status: 'complete',
            current_provider: null,
            updated_at: now,
          },
          { onConflict: 'user_id' }
        );

      return NextResponse.json({
        success: true,
        emailsProcessed: 0,
        dataChanged: false,
      });
    }

    // Fetch details for all messages
    console.log(`[Gmail Sync] Fetching details for ${messages.length} messages...`);
    const emailDetails: ParsedEmail[] = await Promise.all(
      messages.map(async (msg) => {
        const detailResponse = await nango.proxy({
          connectionId,
          providerConfigKey: 'google-mail',
          method: 'GET',
          endpoint: `/gmail/v1/users/me/messages/${msg.id}`,
          params: { format: 'full' },
        });

        const responseData = detailResponse.data as {
          payload?: { headers?: GmailHeader[] };
          headers?: GmailHeader[];
          snippet?: string;
        };
        
        let headers: GmailHeader[] = [];
        if (responseData?.payload?.headers) headers = responseData.payload.headers;
        else if (Array.isArray(responseData?.headers)) headers = responseData.headers;

        const getHeader = (name: string): string => {
          const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
          return header?.value || 'Unknown';
        };

        return {
          id: msg.id,
          from: getHeader('From'),
          subject: getHeader('Subject'),
          date: getHeader('Date'),
          snippet: responseData?.snippet || '',
        };
      })
    );

    // Update status to securing
    await supa
      .from('sync_status')
      .upsert(
        {
          user_id: userId,
          status: 'securing',
          current_provider: 'gmail',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    // DLP scan (batched)
    if (!dlpIssue && emailDetails.length > 0) {
      console.log(`[Gmail Sync] Running DLP scan on ${emailDetails.length} emails...`);
      const contents = emailDetails.map(email => 
        `${email.from}\n${email.subject}\n${email.snippet}`
      );

      const scanResults = await scanContentChunked(contents, 20);

      for (let i = 0; i < emailDetails.length; i++) {
        const scanned = scanResults[i];
        await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });

        const [fromLine, subjectLine, ...snippetLines] = scanned.redacted.split('\n');
        emailDetails[i].from = fromLine || emailDetails[i].from;
        emailDetails[i].subject = subjectLine || emailDetails[i].subject;
        emailDetails[i].snippet = snippetLines.join('\n') || emailDetails[i].snippet;
      }
      console.log(`[Gmail Sync] DLP scan complete`);
    }

    // Persist emails
    console.log(`[Gmail Sync] Persisting ${emailDetails.length} emails...`);
    const rows = emailDetails.map((email) => {
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
        snippet: email.snippet || '',
        received_at: receivedAt,
        security_verified: !dlpIssue,
      };
    });

    const { error: upsertError } = await supa
      .from('emails')
      .upsert(rows, { onConflict: 'user_id,message_id' });

    if (upsertError) {
      console.error('[Gmail Sync] Failed to persist emails:', upsertError);
      throw upsertError;
    }

    // Update connection and status
    const now = new Date().toISOString();
    await supa
      .from('connections')
      .update({ last_sync_at: now, status: 'connected' })
      .eq('user_id', userId)
      .eq('provider', 'gmail');

    await supa
      .from('sync_status')
      .upsert(
        {
          user_id: userId,
          status: 'complete',
          current_provider: null,
          updated_at: now,
        },
        { onConflict: 'user_id' }
      );

    // Trigger embedding generation in background
    if (process.env.OPENAI_API_KEY && emailDetails.length > 0) {
      await inngest.send({
        name: 'embeddings/generate.requested',
        data: { userId, sourceType: 'email', timestamp: now },
      });
    }

    // NOTE: Briefing generation is handled by sync-manager after this route returns
    // This prevents duplicate briefing generation when sync-manager calls this route
    console.log(`[Gmail Sync] Complete. Processed ${emailDetails.length} emails.`);

    return NextResponse.json({
      success: true,
      emailsProcessed: emailDetails.length,
      dataChanged: emailDetails.length > 0,
    });

  } catch (error) {
    console.error('[Gmail Sync] Error:', error);

    // Update status to error
    if (authedUserId) {
      const supa = supabaseAdmin as unknown as SupabaseClient;
      await supa
        .from('sync_status')
        .upsert(
          {
            user_id: authedUserId,
            status: 'error',
            current_provider: 'gmail',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Gmail sync failed' },
      { status: 500 }
    );
  }
}
