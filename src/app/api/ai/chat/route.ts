/**
 * EmergentOS - Chat API
 * 
 * POST /api/ai/chat
 * RAG chat with streaming via Server-Sent Events.
 * Per Section 9.5 and 9.6.
 */

import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { callGeminiChat, isGeminiConfigured } from '@/lib/llm/gemini';
import { buildChatSystemPrompt } from '@/lib/llm/prompts';
import { hybridSearch } from '@/lib/embeddings';

// Map source types to ChatSource kinds
const SOURCE_TYPE_TO_KIND: Record<string, 'email' | 'event' | 'document' | 'briefing'> = {
  email: 'email',
  calendar: 'event',
  drive: 'document',
  briefing: 'briefing',
};

export async function POST(request: Request) {
  try {
    // 1. Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Check Gemini configuration
    if (!isGeminiConfigured()) {
      return new Response(
        JSON.stringify({ error: 'Gemini API not configured' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. Parse request body
    const body = await request.json().catch(() => ({}));
    const { message } = body;

    if (!message || typeof message !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. Get user's connected sources
    const { data: connections } = await supabase
      .from('connections')
      .select('provider, status')
      .eq('user_id', userId)
      .eq('status', 'connected');

    const connectedSources = {
      gmail: connections?.some((c) => c.provider === 'gmail') || false,
      calendar: connections?.some((c) => c.provider === 'calendar') || false,
      drive: connections?.some((c) => c.provider === 'drive') || false,
    };

    // 5. Perform hybrid search for relevant context
    let searchContext: Array<{
      sourceType: string;
      content: string;
      metadata: Record<string, unknown>;
    }> = [];

    // Only search if at least one source is connected
    if (connectedSources.gmail || connectedSources.calendar || connectedSources.drive) {
      try {
        const searchResults = await hybridSearch(userId, message, 5);
        searchContext = searchResults.map((r) => ({
          sourceType: r.sourceType,
          content: r.content,
          metadata: r.metadata,
        }));
      } catch (searchError) {
        console.warn('[Chat] Hybrid search failed:', searchError);
        // Continue without search context
      }
    }

    // 6. Build system prompt with context
    const systemPrompt = buildChatSystemPrompt(connectedSources, searchContext);

    // 7. Call Gemini with streaming
    console.log(`[Chat] Processing message for user ${userId}`);
    const geminiStream = await callGeminiChat(systemPrompt, message);

    // 8. Convert search results to ChatSource format for client
    const sources = searchContext.map((ctx) => ({
      kind: SOURCE_TYPE_TO_KIND[ctx.sourceType] || 'document',
      id: ctx.metadata.source_id || (ctx.metadata as Record<string, string>).message_id || (ctx.metadata as Record<string, string>).event_id || (ctx.metadata as Record<string, string>).document_id || crypto.randomUUID(),
      title: (ctx.metadata as Record<string, string>).subject || (ctx.metadata as Record<string, string>).title || (ctx.metadata as Record<string, string>).name || 'Unknown',
      occurredAt: (ctx.metadata as Record<string, string>).received_at || (ctx.metadata as Record<string, string>).start_time || (ctx.metadata as Record<string, string>).modified_at,
      snippet: ctx.content.substring(0, 100) + (ctx.content.length > 100 ? '...' : ''),
    }));

    // 9. Create a new stream that wraps Gemini stream and appends sources at the end
    // Note: Gemini stream does NOT send [DONE] - we add it here after sources
    const encoder = new TextEncoder();
    const reader = geminiStream.getReader();
    
    const wrappedStream = new ReadableStream({
      async start(controller) {
        try {
          // Pass through all Gemini stream chunks
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          
          // After Gemini stream completes, send sources (if any)
          if (sources.length > 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sources })}\n\n`));
          }
          
          // Send completion signal
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    // 10. Return SSE stream
    return new Response(wrappedStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[Chat API] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
