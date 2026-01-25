/**
 * EmergentOS - Embedding Generation
 * 
 * OpenAI embeddings for semantic search per Section 16.5.
 */

import OpenAI from 'openai';
import { supabase } from './supabase';
import { calculateContentHash } from './helpers';
import {
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSION,
  EMBEDDING_BATCH_SIZE,
  MAX_CONTENT_LENGTH,
} from './constants';

// Initialize OpenAI client
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingInput {
  sourceType: 'email' | 'calendar' | 'drive' | 'briefing';
  sourceId: string;  // External ID (message_id, event_id, document_id, briefing.id)
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  sourceType: 'email' | 'calendar' | 'drive' | 'briefing';
  sourceId: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

// ============================================================================
// Email Types (for prepare functions)
// ============================================================================

interface Email {
  message_id: string;
  sender: string;
  subject: string;
  snippet: string | null;
  received_at: string;
}

interface CalendarEvent {
  event_id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
}

interface DriveDocument {
  document_id: string;
  name: string;
  mime_type: string;
  modified_at: string | null;
  content_preview: string | null;
}

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Generate embeddings for content and upsert to database.
 * Handles batching, deduplication via content_hash, and rate limits.
 */
export async function generateAndStoreEmbeddings(
  userId: string,
  inputs: EmbeddingInput[]
): Promise<{ inserted: number; skipped: number }> {
  if (!openai) {
    console.warn('[Embeddings] OPENAI_API_KEY not configured, skipping');
    return { inserted: 0, skipped: inputs.length };
  }

  if (inputs.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;

  // Process in batches
  for (let i = 0; i < inputs.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = inputs.slice(i, i + EMBEDDING_BATCH_SIZE);

    // Prepare content (truncate if necessary) and calculate hashes
    const preparedBatch = await Promise.all(
      batch.map(async (input) => {
        const truncatedContent = input.content.substring(0, MAX_CONTENT_LENGTH);
        const contentHash = await calculateContentHash(truncatedContent);
        return { ...input, content: truncatedContent, contentHash };
      })
    );

    // Check for existing embeddings with same content_hash (skip unchanged)
    const { data: existing } = await supabase
      .from('embeddings')
      .select('content_hash')
      .eq('user_id', userId)
      .in('content_hash', preparedBatch.map((p) => p.contentHash));

    const existingHashes = new Set(existing?.map((e) => e.content_hash) || []);
    const toEmbed = preparedBatch.filter((p) => !existingHashes.has(p.contentHash));
    skipped += preparedBatch.length - toEmbed.length;

    if (toEmbed.length === 0) continue;

    try {
      // Call OpenAI Embeddings API
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: toEmbed.map((p) => p.content),
        dimensions: EMBEDDING_DIMENSION,
      });

      // Map embeddings back to inputs
      const records = toEmbed.map((input, idx) => ({
        user_id: userId,
        source_type: input.sourceType,
        source_id: input.sourceId,
        content: input.content,
        embedding: `[${response.data[idx].embedding.join(',')}]`, // pgvector format
        metadata: input.metadata || {},
        content_hash: input.contentHash,
      }));

      // UPSERT to handle re-indexing
      const { error } = await supabase
        .from('embeddings')
        .upsert(records, { onConflict: 'user_id,source_type,source_id' });

      if (error) {
        console.error('[Embeddings] UPSERT error:', error);
      } else {
        inserted += records.length;
      }
    } catch (error) {
      console.error('[Embeddings] OpenAI API error:', error);
      // Continue with next batch on error
    }
  }

  return { inserted, skipped };
}

// ============================================================================
// Prepare Functions (per source type)
// ============================================================================

/**
 * Prepare embedding inputs from emails.
 * CRITICAL: Uses message_id (Gmail ID), NOT database UUID
 */
export function prepareEmailEmbeddings(emails: Email[]): EmbeddingInput[] {
  return emails.map((email) => ({
    sourceType: 'email',
    sourceId: email.message_id,  // Gmail message ID
    content: `From: ${email.sender}\nSubject: ${email.subject}\n\n${email.snippet || ''}`,
    metadata: {
      sender: email.sender,
      subject: email.subject,
      received_at: email.received_at,
    },
  }));
}

/**
 * Prepare embedding inputs from calendar events.
 * CRITICAL: Uses event_id (Google Calendar ID), NOT database UUID
 */
export function prepareCalendarEmbeddings(events: CalendarEvent[]): EmbeddingInput[] {
  return events.map((event) => ({
    sourceType: 'calendar',
    sourceId: event.event_id,  // Google Calendar event ID
    content: `${event.title}\n${event.description || ''}\nLocation: ${event.location || 'N/A'}\nTime: ${event.start_time} to ${event.end_time}`,
    metadata: {
      title: event.title,
      start_time: event.start_time,
      end_time: event.end_time,
      location: event.location,
    },
  }));
}

/**
 * Prepare embedding inputs from drive documents.
 * CRITICAL: Uses document_id (Google Drive ID), NOT database UUID
 */
export function prepareDriveEmbeddings(documents: DriveDocument[]): EmbeddingInput[] {
  return documents.map((doc) => ({
    sourceType: 'drive',
    sourceId: doc.document_id,  // Google Drive document ID
    content: `${doc.name}\n${doc.content_preview || ''}`,
    metadata: {
      name: doc.name,
      mime_type: doc.mime_type,
      modified_at: doc.modified_at,
    },
  }));
}

// ============================================================================
// Hybrid Search
// ============================================================================

/**
 * Perform hybrid search combining semantic (vector) and keyword search.
 * Uses Reciprocal Rank Fusion (RRF) to merge results.
 */
export async function hybridSearch(
  userId: string,
  query: string,
  limit: number = 10
): Promise<SearchResult[]> {
  if (!openai) {
    console.warn('[Embeddings] OPENAI_API_KEY not configured, search unavailable');
    return [];
  }

  // 1. Generate query embedding
  const embeddingResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
    dimensions: EMBEDDING_DIMENSION,
  });
  const queryEmbedding = embeddingResponse.data[0].embedding;

  // 2. Semantic search (vector similarity)
  const { data: semanticResults } = await supabase.rpc('match_embeddings', {
    query_embedding: queryEmbedding,
    match_user_id: userId,
    match_count: limit * 2,  // Fetch more for RRF merging
  });

  // 3. Keyword search (full-text)
  const { data: keywordResults } = await supabase
    .from('embeddings')
    .select('source_type, source_id, content, metadata')
    .eq('user_id', userId)
    .textSearch('content', query, { type: 'websearch' })
    .limit(limit * 2);

  // 4. Reciprocal Rank Fusion (RRF) to combine results
  const K = 60;  // RRF constant
  const scoreMap = new Map<string, { result: SearchResult; score: number }>();

  // Score semantic results
  semanticResults?.forEach((r: {
    source_type: string;
    source_id: string;
    content: string;
    metadata: Record<string, unknown>;
    similarity: number;
  }, rank: number) => {
    const key = `${r.source_type}:${r.source_id}`;
    const rrfScore = 1 / (K + rank + 1);
    scoreMap.set(key, {
      result: {
        sourceType: r.source_type as SearchResult['sourceType'],
        sourceId: r.source_id,
        content: r.content,
        score: r.similarity,
        metadata: r.metadata || {},
      },
      score: rrfScore,
    });
  });

  // Add/merge keyword results
  keywordResults?.forEach((r: {
    source_type: string;
    source_id: string;
    content: string;
    metadata: Record<string, unknown>;
  }, rank: number) => {
    const key = `${r.source_type}:${r.source_id}`;
    const rrfScore = 1 / (K + rank + 1);

    if (scoreMap.has(key)) {
      // Already in map, add scores
      scoreMap.get(key)!.score += rrfScore;
    } else {
      scoreMap.set(key, {
        result: {
          sourceType: r.source_type as SearchResult['sourceType'],
          sourceId: r.source_id,
          content: r.content,
          score: rrfScore,
          metadata: r.metadata || {},
        },
        score: rrfScore,
      });
    }
  });

  // 5. Sort by combined score and return top results
  const sorted = Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ result, score }) => ({ ...result, score }));

  return sorted;
}
