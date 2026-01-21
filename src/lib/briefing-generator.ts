import { supabaseAdmin } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { scanContent } from '@/lib/nightfall';
import { upsertPiiVaultTokens } from '@/lib/pii-vault';
import { geminiGenerateText, safeJsonParse } from '@/lib/gemini';
import {
  GmailConfig,
  DriveConfig,
  startOfToday,
  endOfTomorrow,
} from '@/lib/config/data-scope';

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

function getDlpConfigIssue(): string | null {
  if (!process.env.NIGHTFALL_API_KEY) return 'Missing NIGHTFALL_API_KEY';
  const keyB64 = process.env.PII_VAULT_KEY_BASE64;
  if (!keyB64) return 'Missing PII_VAULT_KEY_BASE64';
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) return 'PII_VAULT_KEY_BASE64 must decode to 32 bytes';
  return null;
}

export async function generateBriefingForUser(args: { userId: string; date?: string }) {
  const { userId } = args;
  const date = args.date || isoDateUTC(new Date());

  const supa = supabaseAdmin as unknown as SupabaseClient;

  // CRITICAL: First check which sources are actually connected
  // This determines what data we can use and how to communicate to the user
  // Use the same logic as /api/connections for consistency
  // Try user_id first, then fallback to metadata
  let connections: { provider: string; status: string; updated_at: string }[] | null = null;
  let connError: unknown = null;
  
  // Try direct user_id match first
  const { data: directConns, error: directErr } = await supa
    .from('connections')
    .select('provider,status,updated_at')
    .eq('user_id', userId)
    .in('provider', ['gmail', 'calendar', 'drive'])
    .order('updated_at', { ascending: false });
  
  if (!directErr && directConns && directConns.length > 0) {
    connections = directConns;
  } else {
    // Fallback to metadata lookup
    const { data: metaConns, error: metaErr } = await supa
      .from('connections')
      .select('provider,status,updated_at')
      .contains('metadata', { clerk_user_id: userId })
      .in('provider', ['gmail', 'calendar', 'drive'])
      .order('updated_at', { ascending: false });
    
    if (!metaErr && metaConns) {
      connections = metaConns;
    }
    connError = metaErr;
  }

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

  // ═══════════════════════════════════════════════════════════════════════════
  // TIME BOUNDARIES (from data-scope.ts)
  // ═══════════════════════════════════════════════════════════════════════════
  // Gmail: Yesterday 00:00 → now (full yesterday + today so far)
  // Calendar: Today 00:00 → Tomorrow 23:59 (full today + full tomorrow)
  // Drive: Yesterday 00:00 → now (full yesterday + today so far)
  // ═══════════════════════════════════════════════════════════════════════════

  const gmailTimeRange = GmailConfig.briefing.getTimeRange();
  const driveTimeRange = DriveConfig.briefing.getTimeRange();
  // Calendar time range: Today 00:00 → Tomorrow 23:59
  const calendarFrom = startOfToday();
  const calendarTo = endOfTomorrow();

  const sinceEmails = gmailTimeRange.from.toISOString();
  const sinceDocs = driveTimeRange.from.toISOString();
  const todayStart = calendarFrom.toISOString();
  const tomorrowEnd = calendarTo.toISOString();

  console.log(`[BriefingGenerator] Time ranges - Gmail: ${sinceEmails} → now, Calendar: ${todayStart} → ${tomorrowEnd}, Drive: ${sinceDocs} → now`);

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
          .lte('start_time', tomorrowEnd) // Include tomorrow for preparation
          .order('start_time', { ascending: true })
          .limit(100) // Increased to accommodate 2 days of events
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
    eventLines = '(Clear schedule - no events today or tomorrow)';
  } else {
    // Separate today's and tomorrow's events for clarity
    const todayDate = new Date().toISOString().slice(0, 10);
    const tomorrowDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const todayEvents = (events || []).filter(
      (e) => e.start_time && e.start_time.slice(0, 10) === todayDate
    );
    const tomorrowEvents = (events || []).filter(
      (e) => e.start_time && e.start_time.slice(0, 10) === tomorrowDate
    );

    const formatEvent = (e: { start_time: string; end_time: string; title: string; has_conflict: boolean; location?: string }) =>
      `- ${e.start_time} → ${e.end_time}: ${e.title}${e.has_conflict ? ' [CONFLICT]' : ''}${
        e.location ? ` @ ${e.location}` : ''
      }`;

    const todaySection = todayEvents.length > 0
      ? `TODAY (${todayDate}):\n${todayEvents.map(formatEvent).join('\n')}`
      : `TODAY (${todayDate}): No events scheduled`;

    const tomorrowSection = tomorrowEvents.length > 0
      ? `TOMORROW (${tomorrowDate}):\n${tomorrowEvents.map(formatEvent).join('\n')}`
      : `TOMORROW (${tomorrowDate}): No events scheduled`;

    eventLines = `${todaySection}\n\n${tomorrowSection}`;
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

═══════════════════════════════════════════════════════════════════════════════
RECENT COMMUNICATIONS (Yesterday + Today)
═══════════════════════════════════════════════════════════════════════════════
${emailLines}

═══════════════════════════════════════════════════════════════════════════════
SCHEDULE (Today + Tomorrow)
═══════════════════════════════════════════════════════════════════════════════
${eventLines}

═══════════════════════════════════════════════════════════════════════════════
RECENTLY MODIFIED DOCUMENTS (Yesterday + Today)
═══════════════════════════════════════════════════════════════════════════════
${docLines}

═══════════════════════════════════════════════════════════════════════════════
INSTRUCTIONS
═══════════════════════════════════════════════════════════════════════════════
Generate a concise strategic briefing with:
1) Top 3 Priorities (based on available data)
2) Schedule Overview (today's AND tomorrow's conflicts, key meetings) - only if Calendar is connected
3) Action Items extracted from emails - only if Gmail is connected and has emails
4) Alerts (urgent matters)

CRITICAL RULES:
- "NOT CONNECTED" = User has NOT linked that account. Do NOT reference it.
- "quiet/clear/no activity" = Source IS connected, just no recent activity. This is NORMAL and GOOD (means no urgent items).
- Do NOT say "no data available" or imply something is missing. A quiet inbox is a good thing!
- Focus on what IS there, not what isn't.
- Include tomorrow's meetings in the schedule overview to help with preparation.

Return ONLY valid JSON with this schema:
{
  "summary": "Brief executive summary focusing on actionable insights from available data",
  "priorities": [{ "title": "", "description": "", "source": "gmail|calendar|drive" }],
  "schedule": { "conflicts": [], "key_meetings": [] },
  "actions": [{ "task": "", "due": "", "source": "gmail|calendar|drive" }],
  "alerts": [{ "type": "", "message": "", "source": "gmail|calendar|drive" }]
}
`;

  // DLP gate before LLM (graceful - don't fail briefing if Nightfall is unavailable)
  let scannedPrompt = prompt;
  const dlpIssue = getDlpConfigIssue();
  
  if (dlpIssue) {
    console.warn(`[BriefingGenerator] DLP not configured: ${dlpIssue}, proceeding without redaction`);
  } else {
    try {
      const scanned = await scanContent(prompt);
      scannedPrompt = scanned.redacted;
      await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });
    } catch (dlpErr) {
      console.warn('[BriefingGenerator] DLP scan failed, proceeding without redaction:', dlpErr);
      // Continue with unredacted prompt - better to have a briefing than no briefing
    }
  }

  const llmText = await geminiGenerateText(scannedPrompt);
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

