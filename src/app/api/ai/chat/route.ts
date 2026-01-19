import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { scanContent } from '@/lib/nightfall';
import { upsertPiiVaultTokens } from '@/lib/pii-vault';
import { geminiGenerateText } from '@/lib/gemini';
import type { SupabaseClient } from '@supabase/supabase-js';

type ChatSource = {
  kind: 'email' | 'event' | 'document' | 'briefing';
  id: string;
  title: string;
  occurredAt?: string;
  snippet?: string;
};

type HistoryRow = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: unknown[] | null;
  created_at: string;
};

function isUuid(input: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input);
}

function tokenizeQuery(q: string): string[] {
  const parts = q
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
  return Array.from(new Set(parts)).slice(0, 8);
}

function scoreText(text: string, tokens: string[]): number {
  const t = text.toLowerCase();
  let score = 0;
  for (const tok of tokens) {
    // count occurrences (cheap)
    let idx = 0;
    while (true) {
      const found = t.indexOf(tok, idx);
      if (found === -1) break;
      score += 1;
      idx = found + tok.length;
      if (score > 50) return score;
    }
  }
  return score;
}

async function fetchContext(userId: string, query: string): Promise<{ context: string; sources: ChatSource[] }> {
  const supa = supabaseAdmin as unknown as SupabaseClient;
  const tokens = tokenizeQuery(query);

  // Fetch recent data (tokenized at ingestion time); score client-side for determinism.
  const [{ data: emails }, { data: events }, { data: docs }, { data: briefings }] = await Promise.all([
    supa
      .from('emails')
      .select('id, subject, sender, snippet, body_preview, received_at')
      .eq('user_id', userId)
      .order('received_at', { ascending: false })
      .limit(50),
    supa
      .from('calendar_events')
      .select('id, title, description, start_time, end_time, location')
      .eq('user_id', userId)
      .order('start_time', { ascending: true })
      .limit(50),
    supa
      .from('drive_documents')
      .select('id, name, folder_path, modified_at, web_view_link')
      .eq('user_id', userId)
      .order('modified_at', { ascending: false })
      .limit(50),
    supa
      .from('briefings')
      .select('id, briefing_date, summary, content')
      .eq('user_id', userId)
      .order('briefing_date', { ascending: false })
      .limit(7),
  ]);

  const emailSources: ChatSource[] = (emails ?? [])
    .map((e: Record<string, unknown>) => {
      const subject = String(e.subject ?? '');
      const snippet = String(e.snippet ?? e.body_preview ?? '');
      const sender = String(e.sender ?? '');
      const occurredAt = typeof e.received_at === 'string' ? e.received_at : undefined;
      const text = `${subject}\n${sender}\n${snippet}`;
      return {
        kind: 'email',
        id: String(e.id ?? ''),
        title: subject || '(no subject)',
        occurredAt,
        snippet: snippet || undefined,
        _score: scoreText(text, tokens),
      } as ChatSource & { _score: number };
    })
    .filter((s) => s.id)
    .sort((a, b) => (b as ChatSource & { _score: number })._score - (a as ChatSource & { _score: number })._score)
    .slice(0, 4)
    .map((s) => ({ kind: s.kind, id: s.id, title: s.title, occurredAt: s.occurredAt, snippet: s.snippet }));

  const eventSources: ChatSource[] = (events ?? [])
    .map((e: Record<string, unknown>) => {
      const title = String(e.title ?? '');
      const desc = String(e.description ?? '');
      const loc = String(e.location ?? '');
      const occurredAt = typeof e.start_time === 'string' ? e.start_time : undefined;
      const text = `${title}\n${desc}\n${loc}`;
      return {
        kind: 'event',
        id: String(e.id ?? ''),
        title: title || '(untitled event)',
        occurredAt,
        snippet: desc || undefined,
        _score: scoreText(text, tokens),
      } as ChatSource & { _score: number };
    })
    .filter((s) => s.id)
    .sort((a, b) => (b as ChatSource & { _score: number })._score - (a as ChatSource & { _score: number })._score)
    .slice(0, 4)
    .map((s) => ({ kind: s.kind, id: s.id, title: s.title, occurredAt: s.occurredAt, snippet: s.snippet }));

  const docSources: ChatSource[] = (docs ?? [])
    .map((d: Record<string, unknown>) => {
      const name = String(d.name ?? '');
      const folder = String(d.folder_path ?? '');
      const occurredAt = typeof d.modified_at === 'string' ? d.modified_at : undefined;
      const text = `${name}\n${folder}`;
      return {
        kind: 'document',
        id: String(d.id ?? ''),
        title: name || '(untitled document)',
        occurredAt,
        snippet: folder || undefined,
        _score: scoreText(text, tokens),
      } as ChatSource & { _score: number };
    })
    .filter((s) => s.id)
    .sort((a, b) => (b as ChatSource & { _score: number })._score - (a as ChatSource & { _score: number })._score)
    .slice(0, 4)
    .map((s) => ({ kind: s.kind, id: s.id, title: s.title, occurredAt: s.occurredAt, snippet: s.snippet }));

  const briefingSources: ChatSource[] = (briefings ?? [])
    .map((b: Record<string, unknown>) => {
      const title = `Daily Briefing (${String(b.briefing_date ?? '')})`;
      const summary = String(b.summary ?? '');
      const content = String(b.content ?? '');
      const text = `${summary}\n${content}`;
      return {
        kind: 'briefing',
        id: String(b.id ?? ''),
        title,
        occurredAt: typeof b.briefing_date === 'string' ? b.briefing_date : undefined,
        snippet: summary || undefined,
        _score: scoreText(text, tokens),
      } as ChatSource & { _score: number };
    })
    .filter((s) => s.id)
    .sort((a, b) => (b as ChatSource & { _score: number })._score - (a as ChatSource & { _score: number })._score)
    .slice(0, 2)
    .map((s) => ({ kind: s.kind, id: s.id, title: s.title, occurredAt: s.occurredAt, snippet: s.snippet }));

  const sources = [...emailSources, ...eventSources, ...docSources, ...briefingSources];

  const contextLines = sources.map((s) => {
    const tag = `[${s.kind}:${s.id}]`;
    const when = s.occurredAt ? ` @ ${s.occurredAt}` : '';
    const snippet = s.snippet ? ` — ${s.snippet}` : '';
    return `${tag}${when} ${s.title}${snippet}`;
  });

  const context = contextLines.length
    ? `## Context (tokenized)\n${contextLines.map((l) => `- ${l}`).join('\n')}\n`
    : `## Context (tokenized)\n- (No matching context found)\n`;

  return { context, sources };
}

async function fetchHistory(userId: string, sessionId: string): Promise<HistoryRow[]> {
  const supa = supabaseAdmin as unknown as SupabaseClient;
  const { data } = await supa
    .from('chat_messages')
    .select('id, role, content, sources, created_at')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(50);
  return (data ?? []) as unknown as HistoryRow[];
}

function buildPrompt(args: {
  context: string;
  history: HistoryRow[];
  userMessage: string;
}): string {
  const historyText = args.history
    .slice(-12)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  return [
    `You are EmergentOS, a secure executive assistant.`,
    `All user data is tokenized (e.g., [PERSON_001]) and you must NOT attempt to guess or de-tokenize it.`,
    `Use ONLY the provided context + chat history. If you are unsure, say so and ask a clarifying question.`,
    `When you use a fact from context, cite it at the end of the sentence using the source tag format like [email:<id>] or [event:<id>].`,
    ``,
    args.context,
    `## Chat History (most recent last)`,
    historyText || '(none)',
    ``,
    `## User Question`,
    args.userMessage,
    ``,
    `## Answer`,
  ].join('\n');
}

function sseEncode(event: string, data: string): string {
  // One event, one data line (data is pre-encoded JSON or plain string)
  return `event: ${event}\ndata: ${data}\n\n`;
}

function chunkText(text: string, chunkSize = 80): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + chunkSize));
    i += chunkSize;
  }
  return out;
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId') || '';
  if (!isUuid(sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
  }

  const history = await fetchHistory(userId, sessionId);
  return NextResponse.json({ messages: history });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const b = body as { sessionId?: unknown; message?: unknown };
  const sessionId = typeof b.sessionId === 'string' ? b.sessionId : '';
  const message = typeof b.message === 'string' ? b.message : '';

  if (!isUuid(sessionId)) return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
  if (!message.trim()) return NextResponse.json({ error: 'Message is required' }, { status: 400 });

  const supa = supabaseAdmin as unknown as SupabaseClient;

  // DLP before ANY storage/LLM usage
  const scanned = await scanContent(message);
  await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });

  // Persist user message (tokenized)
  const { data: userInsert, error: userInsertErr } = await supa
    .from('chat_messages')
    .insert({
      user_id: userId,
      session_id: sessionId,
      role: 'user',
      content: scanned.redacted,
      sources: [],
    })
    .select('id')
    .maybeSingle();

  if (userInsertErr) {
    return NextResponse.json({ error: 'Failed to store user message', details: userInsertErr.message }, { status: 500 });
  }

  const history = await fetchHistory(userId, sessionId);
  const { context, sources } = await fetchContext(userId, scanned.redacted);
  const prompt = buildPrompt({ context, history, userMessage: scanned.redacted });

  let answer = '';
  try {
    // Gemini sees ONLY tokenized content
    answer = await geminiGenerateText(prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Chat generation failed', details: msg }, { status: 500 });
  }

  // Persist assistant message (tokenized) + sources
  const { data: assistantInsert, error: assistantInsertErr } = await supa
    .from('chat_messages')
    .insert({
      user_id: userId,
      session_id: sessionId,
      role: 'assistant',
      content: answer,
      sources,
    })
    .select('id')
    .maybeSingle();

  if (assistantInsertErr) {
    return NextResponse.json(
      { error: 'Failed to store assistant message', details: assistantInsertErr.message },
      { status: 500 }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(sseEncode('meta', JSON.stringify({ userMessageId: userInsert?.id ?? null }))));

      for (const chunk of chunkText(answer, 90)) {
        controller.enqueue(encoder.encode(sseEncode('token', JSON.stringify({ delta: chunk }))));
      }

      controller.enqueue(
        encoder.encode(
          sseEncode('done', JSON.stringify({ assistantMessageId: assistantInsert?.id ?? null, sources }))
        )
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

