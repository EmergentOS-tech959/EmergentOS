/**
 * EmergentOS - Chat API Route
 * 
 * Provides AI chat functionality with:
 * - Dynamic system context (date, connection status, data counts)
 * - Hybrid search (semantic + keyword) for context retrieval
 * - DLP scanning before storage
 * - Streaming responses
 * - Source citations
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { scanContent } from '@/lib/nightfall';
import { upsertPiiVaultTokens } from '@/lib/pii-vault';
import { geminiGenerateText } from '@/lib/gemini';
import { searchForChatContext } from '@/lib/hybrid-search';
import { getUserContext, buildSystemContext, buildCompletePrompt } from '@/lib/chat-context';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SourceType } from '@/lib/embeddings';

type ChatSource = {
  kind: SourceType;
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

function sseEncode(event: string, data: string): string {
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

/**
 * GET /api/ai/chat?sessionId=uuid
 * Retrieve chat history for a session
 */
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

/**
 * POST /api/ai/chat
 * Send a message and get a streaming response
 */
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

  // DLP scan before ANY storage/LLM usage
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

  // Fetch all context in parallel
  const [history, userContext, searchResult] = await Promise.all([
    fetchHistory(userId, sessionId),
    getUserContext(userId),
    searchForChatContext(userId, scanned.redacted).catch((err) => {
      console.error('Search failed:', err);
      return { context: '## Relevant Context\n- (Search unavailable)\n', sources: [] as ChatSource[] };
    }),
  ]);

  // Build dynamic system context
  const systemContext = buildSystemContext(userContext);

  // Build complete prompt
  const prompt = buildCompletePrompt({
    systemContext,
    searchContext: searchResult.context,
    history: history.map(h => ({ role: h.role, content: h.content })),
    userMessage: scanned.redacted,
  });

  const sources = searchResult.sources;

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

  // Stream response
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
