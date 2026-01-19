import { supabaseAdmin } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { scanContent } from '@/lib/nightfall';
import { upsertPiiVaultTokens } from '@/lib/pii-vault';
import { geminiGenerateText, safeJsonParse } from '@/lib/gemini';

type BriefingJson = {
  summary: string;
  priorities?: Array<{ title: string; description: string; source?: string }>;
  schedule?: { conflicts?: unknown[]; key_meetings?: unknown[] };
  actions?: Array<{ task: string; due?: string; source?: string }>;
  alerts?: Array<{ type: string; message: string; source?: string }>;
};

function isoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDayRange(d: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
  return { start: start.toISOString(), end: end.toISOString() };
}

function requireDlpReady() {
  if (!process.env.NIGHTFALL_API_KEY) throw new Error('Missing NIGHTFALL_API_KEY (DLP gate required)');
  const keyB64 = process.env.PII_VAULT_KEY_BASE64;
  if (!keyB64) throw new Error('Missing PII_VAULT_KEY_BASE64 (PII vault key required)');
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('PII_VAULT_KEY_BASE64 must decode to 32 bytes (AES-256 key)');
}

export async function generateBriefingForUser(args: { userId: string; date?: string }) {
  requireDlpReady();
  const { userId } = args;
  const date = args.date || isoDateUTC(new Date());

  const supa = supabaseAdmin as unknown as SupabaseClient;

  // CRITICAL: First check which sources are actually connected
  // This determines what data we can use and how to communicate to the user
  // Use the same logic as /api/connections for consistency
  const { data: connections, error: connError } = await supa
    .from('connections')
    .select('provider,status,updated_at')
    .or(`user_id.eq.${userId},metadata->>clerk_user_id.eq.${userId}`)
    .in('provider', ['gmail', 'calendar', 'drive'])
    .order('updated_at', { ascending: false });

  if (connError) {
    console.error('[BriefingGenerator] Failed to fetch connections:', connError);
  }

  console.log(`[BriefingGenerator] Raw connections for user ${userId}:`, JSON.stringify(connections, null, 2));

  // Use a seen set to only process the most recent row per provider (ordered by updated_at desc)
  const connectionMap: Record<string, boolean> = {
    gmail: false,
    calendar: false,
    drive: false,
  };
  const seen = new Set<string>();
  for (const conn of connections || []) {
    const provider = conn.provider as string;
    if (!provider || seen.has(provider)) continue;
    seen.add(provider);
    if (conn.status === 'connected') {
      connectionMap[provider] = true;
    }
  }

  const gmailConnected = connectionMap.gmail;
  const calendarConnected = connectionMap.calendar;
  const driveConnected = connectionMap.drive;

  console.log(`[BriefingGenerator] Connection status - Gmail: ${gmailConnected}, Calendar: ${calendarConnected}, Drive: ${driveConnected}`);

  const now = Date.now();
  const sinceEmails = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const sinceDocs = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  const { start: todayStart, end: todayEnd } = utcDayRange(new Date());

  // Only fetch data from connected sources
  const [{ data: emails }, { data: events }, { data: docs }] = await Promise.all([
    gmailConnected
      ? supa
          .from('emails')
          .select('message_id,sender,subject,received_at')
          .eq('user_id', userId)
          .gte('received_at', sinceEmails)
          .order('received_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: null }),
    calendarConnected
      ? supa
          .from('calendar_events')
          .select('event_id,title,start_time,end_time,has_conflict,location')
          .eq('user_id', userId)
          .gte('start_time', todayStart)
          .lte('start_time', todayEnd)
          .order('start_time', { ascending: true })
          .limit(50)
      : Promise.resolve({ data: null }),
    driveConnected
      ? supa
          .from('drive_documents')
          .select('document_id,name,modified_at,is_context_folder,folder_path')
          .eq('user_id', userId)
          .gte('modified_at', sinceDocs)
          .order('modified_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: null }),
  ]);

  // CRITICAL: Clearly indicate connection status in the briefing prompt
  // "No recent data" is NORMAL - our system only tracks recent activity, so empty = quiet inbox/drive
  let emailLines: string;
  if (!gmailConnected) {
    emailLines = '[GMAIL NOT CONNECTED - Cannot access email data]';
  } else if ((emails || []).length === 0) {
    emailLines = '(Inbox is quiet - no new emails in the last 24 hours)';
  } else {
    emailLines = (emails || []).map((e) => `- From: ${e.sender} | Subject: ${e.subject} | Time: ${e.received_at}`).join('\n');
  }

  let eventLines: string;
  if (!calendarConnected) {
    eventLines = '[CALENDAR NOT CONNECTED - Cannot access schedule data]';
  } else if ((events || []).length === 0) {
    eventLines = '(Clear schedule - no events today)';
  } else {
    eventLines = (events || [])
      .map(
        (e) =>
          `- ${e.start_time} → ${e.end_time}: ${e.title}${e.has_conflict ? ' [CONFLICT]' : ''}${
            e.location ? ` @ ${e.location}` : ''
          }`
      )
      .join('\n');
  }

  let docLines: string;
  if (!driveConnected) {
    docLines = '[GOOGLE DRIVE NOT CONNECTED - Cannot access document data]';
  } else if ((docs || []).length === 0) {
    docLines = '(No document activity in the last 48 hours)';
  } else {
    docLines = (docs || [])
      .map(
        (d) =>
          `- ${d.name} (modified: ${d.modified_at})${d.is_context_folder ? ' [CONTEXT]' : ''}${
            d.folder_path ? ` folder:${d.folder_path}` : ''
          }`
      )
      .join('\n');
  }

  // Build connection status summary for prompt
  const connectedSources: string[] = [];
  const disconnectedSources: string[] = [];
  if (gmailConnected) connectedSources.push('Gmail');
  else disconnectedSources.push('Gmail');
  if (calendarConnected) connectedSources.push('Calendar');
  else disconnectedSources.push('Calendar');
  if (driveConnected) connectedSources.push('Drive');
  else disconnectedSources.push('Drive');

  const connectionStatusLine = disconnectedSources.length > 0
    ? `\nNOTE: The following sources are NOT connected: ${disconnectedSources.join(', ')}. Do not make assumptions about data from disconnected sources.`
    : '';

  const prompt = `You are an executive assistant creating a daily strategic briefing.

Today's Date (UTC): ${date}
Connected Data Sources: ${connectedSources.length > 0 ? connectedSources.join(', ') : 'None'}${connectionStatusLine}

Recent Communications (Last 24 Hours):
${emailLines}

Today's Schedule:
${eventLines}

Recently Modified Documents (Last 48 Hours):
${docLines}

Instructions:
Generate a concise strategic briefing with:
1) Top 3 Priorities (based on available data)
2) Schedule Overview (conflicts, key meetings) - only if Calendar is connected and has events
3) Action Items extracted from emails - only if Gmail is connected and has emails
4) Alerts (urgent matters)

CRITICAL RULES:
- "NOT CONNECTED" = User has NOT linked that account. Do NOT reference it.
- "quiet/clear/no activity" = Source IS connected, just no recent activity. This is NORMAL and GOOD (means no urgent items).
- Do NOT say "no data available" or imply something is missing. A quiet inbox is a good thing!
- Focus on what IS there, not what isn't.

Return ONLY valid JSON with this schema:
{
  "summary": "Brief executive summary focusing on actionable insights from available data",
  "priorities": [{ "title": "", "description": "", "source": "gmail|calendar|drive" }],
  "schedule": { "conflicts": [], "key_meetings": [] },
  "actions": [{ "task": "", "due": "", "source": "gmail|calendar|drive" }],
  "alerts": [{ "type": "", "message": "", "source": "gmail|calendar|drive" }]
}
`;

  // DLP gate before LLM
  const scanned = await scanContent(prompt);
  await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });

  const llmText = await geminiGenerateText(scanned.redacted);
  const parsed = safeJsonParse<BriefingJson>(llmText);

  const summary = parsed?.summary || llmText.slice(0, 600);
  const key_priorities = parsed?.priorities || [];
  const schedule_summary = parsed?.schedule || { conflicts: [], key_meetings: [] };

  // CRITICAL: Include connection status in sources so UI can display accurately
  const sources = {
    connections: {
      gmail: gmailConnected,
      calendar: calendarConnected,
      drive: driveConnected,
    },
    emails: gmailConnected ? (emails || []).map((e) => ({ message_id: e.message_id })) : [],
    events: calendarConnected ? (events || []).map((e) => ({ event_id: e.event_id })) : [],
    documents: driveConnected ? (docs || []).map((d) => ({ document_id: d.document_id })) : [],
  };

  const row = {
    user_id: userId,
    briefing_date: date,
    content: parsed ? JSON.stringify(parsed) : llmText,
    summary,
    key_priorities,
    schedule_summary,
    sources,
    generated_at: new Date().toISOString(),
  };

  const { error } = await supa.from('briefings').upsert(row, { onConflict: 'user_id,briefing_date' });
  if (error) throw error;

  return { success: true, userId, date };
}

export async function listBriefingUserIds(): Promise<string[]> {
  const supa = supabaseAdmin as unknown as SupabaseClient;
  const { data, error } = await supa
    .from('connections')
    .select('user_id,provider,status')
    .in('provider', ['gmail', 'calendar', 'drive'])
    .eq('status', 'connected')
    .limit(2000);
  if (error) throw error;
  const out = new Set<string>();
  for (const row of data || []) {
    if (row?.user_id) out.add(String(row.user_id));
  }
  return Array.from(out);
}

