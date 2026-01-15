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

  const now = Date.now();
  const sinceEmails = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const sinceDocs = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  const { start: todayStart, end: todayEnd } = utcDayRange(new Date());

  const [{ data: emails }, { data: events }, { data: docs }] = await Promise.all([
    supa
      .from('emails')
      .select('message_id,sender,subject,received_at')
      .eq('user_id', userId)
      .gte('received_at', sinceEmails)
      .order('received_at', { ascending: false })
      .limit(20),
    supa
      .from('calendar_events')
      .select('event_id,title,start_time,end_time,has_conflict,location')
      .eq('user_id', userId)
      .gte('start_time', todayStart)
      .lte('start_time', todayEnd)
      .order('start_time', { ascending: true })
      .limit(50),
    supa
      .from('drive_documents')
      .select('document_id,name,modified_at,is_context_folder,folder_path')
      .eq('user_id', userId)
      .gte('modified_at', sinceDocs)
      .order('modified_at', { ascending: false })
      .limit(20),
  ]);

  const emailLines =
    (emails || []).map((e) => `- From: ${e.sender} | Subject: ${e.subject} | Time: ${e.received_at}`).join('\n') ||
    '(none)';

  const eventLines =
    (events || [])
      .map(
        (e) =>
          `- ${e.start_time} → ${e.end_time}: ${e.title}${e.has_conflict ? ' [CONFLICT]' : ''}${
            e.location ? ` @ ${e.location}` : ''
          }`
      )
      .join('\n') || '(none)';

  const docLines =
    (docs || [])
      .map(
        (d) =>
          `- ${d.name} (modified: ${d.modified_at})${d.is_context_folder ? ' [CONTEXT]' : ''}${
            d.folder_path ? ` folder:${d.folder_path}` : ''
          }`
      )
      .join('\n') || '(none)';

  const prompt = `You are an executive assistant creating a daily strategic briefing.

Today's Date (UTC): ${date}

Recent Communications (Last 24 Hours):
${emailLines}

Today's Schedule:
${eventLines}

Recently Modified Documents (Last 48 Hours):
${docLines}

Instructions:
Generate a concise strategic briefing with:
1) Top 3 Priorities
2) Schedule Overview (conflicts, key meetings)
3) Action Items extracted from emails
4) Alerts (urgent matters)

Return ONLY valid JSON with this schema:
{
  "summary": "One-paragraph executive summary",
  "priorities": [{ "title": "", "description": "", "source": "" }],
  "schedule": { "conflicts": [], "key_meetings": [] },
  "actions": [{ "task": "", "due": "", "source": "" }],
  "alerts": [{ "type": "", "message": "", "source": "" }]
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

  const sources = {
    emails: (emails || []).map((e) => ({ message_id: e.message_id })),
    events: (events || []).map((e) => ({ event_id: e.event_id })),
    documents: (docs || []).map((d) => ({ document_id: d.document_id })),
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

