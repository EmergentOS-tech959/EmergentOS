/**
 * EmergentOS - Search API Route
 * 
 * Provides hybrid search (semantic + keyword) across user data:
 * - Emails
 * - Calendar events
 * - Drive documents
 * - Daily briefings
 * 
 * GET /api/ai/search?q=query&types=email,calendar&limit=10
 * POST /api/ai/search { query, sourceTypes, limit }
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { hybridSearch, enrichSearchResults, type SearchResult } from '@/lib/hybrid-search';
import type { SourceType } from '@/lib/embeddings';

interface SearchRequestBody {
  query?: string;
  sourceTypes?: SourceType[];
  limit?: number;
  includeContent?: boolean;
}

interface SearchResponseItem {
  id: string;
  sourceType: SourceType;
  sourceId: string;
  title: string;
  snippet?: string;
  occurredAt?: string;
  score: number;
  matchType: 'semantic' | 'keyword' | 'both';
  metadata?: Record<string, unknown>;
}

function formatResult(result: SearchResult): SearchResponseItem {
  let title = '';
  let snippet: string | undefined;
  let occurredAt: string | undefined;

  switch (result.sourceType) {
    case 'email':
      title = String(result.metadata.subject || '(no subject)');
      snippet = String(result.metadata.snippet || result.metadata.body_preview || result.content || '').slice(0, 200);
      occurredAt = result.metadata.received_at as string | undefined;
      break;
    case 'calendar':
      title = String(result.metadata.title || 'Untitled Event');
      snippet = String(result.metadata.description || result.metadata.location || result.content || '').slice(0, 200);
      occurredAt = result.metadata.start_time as string | undefined;
      break;
    case 'drive':
      title = String(result.metadata.name || 'Untitled Document');
      snippet = String(result.metadata.folder_path || result.content || '').slice(0, 200);
      occurredAt = result.metadata.modified_at as string | undefined;
      break;
    case 'briefing':
      title = `Daily Briefing (${result.metadata.briefing_date || ''})`;
      snippet = String(result.metadata.summary || result.content || '').slice(0, 200);
      occurredAt = result.metadata.briefing_date as string | undefined;
      break;
  }

  return {
    id: result.id,
    sourceType: result.sourceType,
    sourceId: result.sourceId,
    title,
    snippet,
    occurredAt,
    score: Math.round(result.score * 100) / 100,
    matchType: result.matchType,
    metadata: result.metadata,
  };
}

function parseSourceTypes(types: string | null): SourceType[] | undefined {
  if (!types) return undefined;
  
  const valid: SourceType[] = ['email', 'calendar', 'drive', 'briefing'];
  const parsed = types.split(',').map((t) => t.trim().toLowerCase() as SourceType);
  const filtered = parsed.filter((t) => valid.includes(t));
  
  return filtered.length > 0 ? filtered : undefined;
}

/**
 * GET /api/ai/search?q=query&types=email,calendar&limit=10
 */
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const query = url.searchParams.get('q') || url.searchParams.get('query') || '';
  const typesParam = url.searchParams.get('types');
  const limitParam = url.searchParams.get('limit');

  if (!query.trim()) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }

  const sourceTypes = parseSourceTypes(typesParam);
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 50) : 10;

  try {
    const results = await hybridSearch(userId, query, { sourceTypes, limit });
    const enriched = await enrichSearchResults(userId, results);
    const formatted = enriched.map(formatResult);

    return NextResponse.json({
      success: true,
      query,
      count: formatted.length,
      results: formatted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Search error:', message);
    return NextResponse.json({ error: 'Search failed', details: message }, { status: 500 });
  }
}

/**
 * POST /api/ai/search
 * Body: { query, sourceTypes?, limit?, includeContent? }
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: SearchRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { query, sourceTypes, limit: rawLimit, includeContent } = body;

  if (!query || typeof query !== 'string' || !query.trim()) {
    return NextResponse.json({ error: 'Query is required' }, { status: 400 });
  }

  // Validate source types
  const validTypes: SourceType[] = ['email', 'calendar', 'drive', 'briefing'];
  const filteredTypes = sourceTypes?.filter((t) => validTypes.includes(t));

  const limit = rawLimit ? Math.min(Math.max(rawLimit, 1), 50) : 10;

  try {
    const results = await hybridSearch(userId, query, {
      sourceTypes: filteredTypes && filteredTypes.length > 0 ? filteredTypes : undefined,
      limit,
    });
    const enriched = await enrichSearchResults(userId, results);
    const formatted = enriched.map((r) => {
      const base = formatResult(r);
      if (includeContent) {
        return { ...base, content: r.content };
      }
      return base;
    });

    return NextResponse.json({
      success: true,
      query,
      count: formatted.length,
      results: formatted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Search error:', message);
    return NextResponse.json({ error: 'Search failed', details: message }, { status: 500 });
  }
}
