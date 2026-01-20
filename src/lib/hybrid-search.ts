/**
 * EmergentOS - Hybrid Search (RAG)
 * 
 * Combines:
 * 1. Semantic search using pgvector similarity
 * 2. Keyword search using PostgreSQL text search
 * 3. Reciprocal Rank Fusion to merge results
 */

import { supabaseAdmin } from './supabase-server';
import { generateQueryEmbedding, type SourceType } from './embeddings';
import type { SupabaseClient } from '@supabase/supabase-js';

const supa = supabaseAdmin as unknown as SupabaseClient;

// Configuration
const SEARCH_CONFIG = {
  semanticTopK: 10,
  keywordTopK: 10,
  finalResultLimit: 8,
  similarityThreshold: 0.65,
  rrfConstant: 60, // Reciprocal Rank Fusion constant
  
  // Lookback periods (in days)
  emailLookbackDays: 7,
  calendarPastDays: 7,
  calendarFutureDays: 30,
  driveLookbackDays: 30,
  briefingLookbackDays: 7,
};

export interface SearchResult {
  id: string;
  sourceType: SourceType;
  sourceId: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
  matchType: 'semantic' | 'keyword' | 'both';
}

export interface SearchOptions {
  sourceTypes?: SourceType[];
  limit?: number;
  includeContent?: boolean;
}

/**
 * Tokenize query for keyword search
 */
function tokenizeQuery(query: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
    'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
    'my', 'your', 'his', 'her', 'its', 'our', 'their', 'me', 'him',
  ]);

  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && !stopWords.has(s))
    .slice(0, 10); // Limit to 10 terms
}

/**
 * Score text against keywords
 */
function scoreKeywordMatch(text: string, tokens: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    let idx = 0;
    while (true) {
      const found = lower.indexOf(token, idx);
      if (found === -1) break;
      score += 1;
      idx = found + token.length;
      if (score > 20) return score; // Cap for performance
    }
  }

  return score;
}

/**
 * Semantic search using pgvector
 */
async function semanticSearch(
  userId: string,
  queryEmbedding: number[],
  options: SearchOptions
): Promise<SearchResult[]> {
  const { sourceTypes, limit = SEARCH_CONFIG.semanticTopK } = options;

  // Use RPC function for vector similarity search
  const { data, error } = await supa.rpc('match_embeddings', {
    query_embedding: `[${queryEmbedding.join(',')}]`,
    match_threshold: SEARCH_CONFIG.similarityThreshold,
    match_count: limit,
    filter_user_id: userId,
    filter_source_types: sourceTypes || ['email', 'calendar', 'drive', 'briefing'],
  });

  if (error) {
    console.error('Semantic search error:', error);
    return [];
  }

  return (data || []).map((row: {
    id: string;
    source_type: SourceType;
    source_id: string;
    content: string;
    metadata: Record<string, unknown>;
    similarity: number;
  }) => ({
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    content: row.content,
    metadata: row.metadata || {},
    score: row.similarity,
    matchType: 'semantic' as const,
  }));
}

/**
 * Keyword search using client-side scoring
 * (Fallback when pgvector not available or for supplementing results)
 */
async function keywordSearch(
  userId: string,
  query: string,
  options: SearchOptions
): Promise<SearchResult[]> {
  const { sourceTypes = ['email', 'calendar', 'drive', 'briefing'], limit = SEARCH_CONFIG.keywordTopK } = options;
  const tokens = tokenizeQuery(query);

  if (tokens.length === 0) {
    return [];
  }

  // Fetch from embeddings table (already has content stored)
  const { data: embeddings, error } = await supa
    .from('embeddings')
    .select('id, source_type, source_id, content, metadata')
    .eq('user_id', userId)
    .in('source_type', sourceTypes)
    .limit(500); // Fetch more for client-side filtering

  if (error || !embeddings) {
    console.error('Keyword search error:', error);
    return [];
  }

  // Score and sort
  const scored = embeddings
    .map((row) => ({
      id: row.id as string,
      sourceType: row.source_type as SourceType,
      sourceId: row.source_id as string,
      content: row.content as string,
      metadata: (row.metadata || {}) as Record<string, unknown>,
      score: scoreKeywordMatch(row.content || '', tokens),
      matchType: 'keyword' as const,
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Normalize scores (0-1 range)
  const maxScore = Math.max(...scored.map((r) => r.score), 1);
  return scored.map((r) => ({
    ...r,
    score: r.score / maxScore,
  }));
}

/**
 * Reciprocal Rank Fusion to merge semantic and keyword results
 */
function reciprocalRankFusion(
  semanticResults: SearchResult[],
  keywordResults: SearchResult[],
  k: number = SEARCH_CONFIG.rrfConstant
): SearchResult[] {
  const scores = new Map<string, { score: number; result: SearchResult; types: Set<string> }>();

  // Score from semantic search
  semanticResults.forEach((result, rank) => {
    const key = `${result.sourceType}:${result.sourceId}`;
    const rrfScore = 1 / (k + rank + 1);
    const existing = scores.get(key);
    if (existing) {
      existing.score += rrfScore;
      existing.types.add('semantic');
    } else {
      scores.set(key, { score: rrfScore, result, types: new Set(['semantic']) });
    }
  });

  // Score from keyword search
  keywordResults.forEach((result, rank) => {
    const key = `${result.sourceType}:${result.sourceId}`;
    const rrfScore = 1 / (k + rank + 1);
    const existing = scores.get(key);
    if (existing) {
      existing.score += rrfScore;
      existing.types.add('keyword');
    } else {
      scores.set(key, { score: rrfScore, result, types: new Set(['keyword']) });
    }
  });

  // Sort by combined score and determine match type
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ result, score, types }) => ({
      ...result,
      score,
      matchType: types.size > 1 ? 'both' as const : (types.has('semantic') ? 'semantic' as const : 'keyword' as const),
    }));
}

/**
 * Hybrid search combining semantic and keyword search
 */
export async function hybridSearch(
  userId: string,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = SEARCH_CONFIG.finalResultLimit } = options;

  // Check if we have embeddings configured
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  let semanticResults: SearchResult[] = [];
  let keywordResults: SearchResult[] = [];

  // Run semantic search if OpenAI is configured
  if (hasOpenAI) {
    try {
      const queryEmbedding = await generateQueryEmbedding(query);
      semanticResults = await semanticSearch(userId, queryEmbedding, options);
    } catch (err) {
      console.error('Semantic search failed, falling back to keyword only:', err);
    }
  }

  // Always run keyword search as backup/supplement
  keywordResults = await keywordSearch(userId, query, options);

  // If no semantic results, return keyword results
  if (semanticResults.length === 0) {
    return keywordResults.slice(0, limit);
  }

  // If no keyword results, return semantic results
  if (keywordResults.length === 0) {
    return semanticResults.slice(0, limit);
  }

  // Merge using RRF
  const merged = reciprocalRankFusion(semanticResults, keywordResults);
  return merged.slice(0, limit);
}

/**
 * Enrich search results with full source data
 */
export async function enrichSearchResults(
  userId: string,
  results: SearchResult[]
): Promise<SearchResult[]> {
  if (results.length === 0) return [];

  // Group by source type
  const byType: Record<SourceType, string[]> = {
    email: [],
    calendar: [],
    drive: [],
    briefing: [],
  };

  for (const result of results) {
    byType[result.sourceType].push(result.sourceId);
  }

  // Fetch full data for each type
  const enriched: Map<string, Record<string, unknown>> = new Map();

  if (byType.email.length > 0) {
    const { data } = await supa
      .from('emails')
      .select('id, subject, sender, snippet, body_preview, received_at')
      .eq('user_id', userId)
      .in('id', byType.email);
    (data || []).forEach((e) => enriched.set(`email:${e.id}`, e));
  }

  if (byType.calendar.length > 0) {
    const { data } = await supa
      .from('calendar_events')
      .select('id, title, description, start_time, end_time, location, attendees')
      .eq('user_id', userId)
      .in('id', byType.calendar);
    (data || []).forEach((e) => enriched.set(`calendar:${e.id}`, e));
  }

  if (byType.drive.length > 0) {
    const { data } = await supa
      .from('drive_documents')
      .select('id, name, mime_type, folder_path, modified_at, web_view_link')
      .eq('user_id', userId)
      .in('id', byType.drive);
    (data || []).forEach((e) => enriched.set(`drive:${e.id}`, e));
  }

  if (byType.briefing.length > 0) {
    const { data } = await supa
      .from('briefings')
      .select('id, briefing_date, summary, content')
      .eq('user_id', userId)
      .in('id', byType.briefing);
    (data || []).forEach((e) => enriched.set(`briefing:${e.id}`, e));
  }

  // Merge enriched data into results
  return results.map((result) => {
    const key = `${result.sourceType}:${result.sourceId}`;
    const fullData = enriched.get(key);
    if (fullData) {
      return {
        ...result,
        metadata: { ...result.metadata, ...fullData },
      };
    }
    return result;
  });
}

/**
 * Quick search for chat context (optimized for speed)
 */
export async function searchForChatContext(
  userId: string,
  query: string,
  sourceTypes?: SourceType[]
): Promise<{
  context: string;
  sources: Array<{
    kind: SourceType;
    id: string;
    title: string;
    occurredAt?: string;
    snippet?: string;
  }>;
}> {
  const results = await hybridSearch(userId, query, {
    sourceTypes,
    limit: 8,
  });

  const enrichedResults = await enrichSearchResults(userId, results);

  const sources = enrichedResults.map((r) => {
    let title = '';
    let occurredAt: string | undefined;
    let snippet: string | undefined;

    switch (r.sourceType) {
      case 'email':
        title = String(r.metadata.subject || '(no subject)');
        occurredAt = r.metadata.received_at as string | undefined;
        snippet = String(r.metadata.snippet || r.metadata.body_preview || '');
        break;
      case 'calendar':
        title = String(r.metadata.title || 'Untitled Event');
        occurredAt = r.metadata.start_time as string | undefined;
        snippet = String(r.metadata.description || r.metadata.location || '');
        break;
      case 'drive':
        title = String(r.metadata.name || 'Untitled Document');
        occurredAt = r.metadata.modified_at as string | undefined;
        snippet = String(r.metadata.folder_path || '');
        break;
      case 'briefing':
        title = `Daily Briefing (${r.metadata.briefing_date || ''})`;
        occurredAt = r.metadata.briefing_date as string | undefined;
        snippet = String(r.metadata.summary || '');
        break;
    }

    return {
      kind: r.sourceType,
      id: r.sourceId,
      title,
      occurredAt,
      snippet: snippet?.slice(0, 200),
    };
  });

  // Build context string
  const contextLines = sources.map((s) => {
    const tag = `[${s.kind}:${s.id}]`;
    const when = s.occurredAt ? ` @ ${s.occurredAt}` : '';
    const snippet = s.snippet ? ` — ${s.snippet}` : '';
    return `${tag}${when} ${s.title}${snippet}`;
  });

  const context = contextLines.length
    ? `## Relevant Context\n${contextLines.map((l) => `- ${l}`).join('\n')}\n`
    : `## Relevant Context\n- (No matching context found)\n`;

  return { context, sources };
}
