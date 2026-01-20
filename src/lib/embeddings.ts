/**
 * EmergentOS - Embedding Generation Utility
 * 
 * Uses OpenAI text-embedding-3-small (1536 dimensions)
 * - 5x cheaper than ada-002
 * - Better quality
 * - Same dimension size (no schema change)
 */

import { supabaseAdmin } from './supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';

const supa = supabaseAdmin as unknown as SupabaseClient;

// Configuration
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const MAX_TOKENS_PER_TEXT = 8000; // Model limit ~8191, leave buffer
const BATCH_SIZE = 50; // OpenAI allows up to 2048, but 50 is safer for rate limits

export type SourceType = 'email' | 'calendar' | 'drive' | 'briefing';

export interface EmbeddingInput {
  sourceType: SourceType;
  sourceId: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingResult {
  success: boolean;
  embedded: number;
  skipped: number;
  errors: string[];
}

/**
 * Truncate text to fit within token limit
 * Rough estimate: 1 token ≈ 4 characters for English
 */
function truncateText(text: string, maxTokens: number = MAX_TOKENS_PER_TEXT): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '...';
}

/**
 * Generate embeddings via OpenAI API
 */
async function callOpenAIEmbeddings(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  // Sort by index to maintain order
  const sorted = data.data.sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

/**
 * Generate and store embeddings for a batch of items
 */
export async function generateEmbeddings(
  userId: string,
  inputs: EmbeddingInput[]
): Promise<EmbeddingResult> {
  const result: EmbeddingResult = {
    success: true,
    embedded: 0,
    skipped: 0,
    errors: [],
  };

  if (inputs.length === 0) {
    return result;
  }

  // Check which items already have embeddings
  const sourceIds = inputs.map((i) => i.sourceId);
  const { data: existingEmbeddings } = await supa
    .from('embeddings')
    .select('source_id')
    .eq('user_id', userId)
    .in('source_id', sourceIds);

  const existingIds = new Set((existingEmbeddings ?? []).map((e) => e.source_id));

  // Filter to only new items
  const toEmbed = inputs.filter((i) => !existingIds.has(i.sourceId));
  result.skipped = inputs.length - toEmbed.length;

  if (toEmbed.length === 0) {
    return result;
  }

  // Process in batches
  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + BATCH_SIZE);
    const texts = batch.map((item) => truncateText(item.content));

    try {
      const embeddings = await callOpenAIEmbeddings(texts);

      // Prepare rows for insertion
      const rows = batch.map((item, idx) => ({
        user_id: userId,
        source_type: item.sourceType,
        source_id: item.sourceId,
        content: truncateText(item.content, 2000), // Store truncated content for display
        metadata: item.metadata ?? {},
        embedding: `[${embeddings[idx].join(',')}]`, // pgvector format
      }));

      // Insert embeddings
      const { error } = await supa.from('embeddings').insert(rows);

      if (error) {
        result.errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
      } else {
        result.embedded += batch.length;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${msg}`);
    }
  }

  result.success = result.errors.length === 0;
  return result;
}

/**
 * Generate embedding for a single query (for search)
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const truncated = truncateText(query);
  const embeddings = await callOpenAIEmbeddings([truncated]);
  return embeddings[0];
}

/**
 * Delete embeddings for a user's source
 */
export async function deleteEmbeddings(
  userId: string,
  sourceType?: SourceType,
  sourceIds?: string[]
): Promise<void> {
  let query = supa.from('embeddings').delete().eq('user_id', userId);

  if (sourceType) {
    query = query.eq('source_type', sourceType);
  }

  if (sourceIds && sourceIds.length > 0) {
    query = query.in('source_id', sourceIds);
  }

  await query;
}

/**
 * Build embedding inputs from emails
 */
export function buildEmailEmbeddingInputs(
  emails: Array<{
    id: string;
    subject?: string;
    sender?: string;
    snippet?: string;
    body_preview?: string;
    received_at?: string;
  }>
): EmbeddingInput[] {
  return emails.map((email) => ({
    sourceType: 'email' as SourceType,
    sourceId: email.id,
    content: [
      `Subject: ${email.subject || '(no subject)'}`,
      `From: ${email.sender || 'Unknown'}`,
      email.snippet || email.body_preview || '',
    ].join('\n'),
    metadata: {
      subject: email.subject,
      sender: email.sender,
      received_at: email.received_at,
    },
  }));
}

/**
 * Build embedding inputs from calendar events
 */
export function buildCalendarEmbeddingInputs(
  events: Array<{
    id: string;
    title?: string;
    description?: string;
    location?: string;
    start_time?: string;
    end_time?: string;
    attendees?: unknown[];
  }>
): EmbeddingInput[] {
  return events.map((event) => {
    const attendeeCount = Array.isArray(event.attendees) ? event.attendees.length : 0;
    return {
      sourceType: 'calendar' as SourceType,
      sourceId: event.id,
      content: [
        `Event: ${event.title || 'Untitled'}`,
        event.description || '',
        event.location ? `Location: ${event.location}` : '',
        `Time: ${event.start_time || ''} - ${event.end_time || ''}`,
        attendeeCount > 0 ? `Attendees: ${attendeeCount}` : '',
      ].filter(Boolean).join('\n'),
      metadata: {
        title: event.title,
        start_time: event.start_time,
        end_time: event.end_time,
        location: event.location,
      },
    };
  });
}

/**
 * Build embedding inputs from drive documents
 */
export function buildDriveEmbeddingInputs(
  docs: Array<{
    id: string;
    name?: string;
    mime_type?: string;
    folder_path?: string;
    modified_at?: string;
  }>
): EmbeddingInput[] {
  return docs.map((doc) => ({
    sourceType: 'drive' as SourceType,
    sourceId: doc.id,
    content: [
      `Document: ${doc.name || 'Untitled'}`,
      doc.folder_path ? `Folder: ${doc.folder_path}` : '',
      doc.mime_type ? `Type: ${doc.mime_type}` : '',
    ].filter(Boolean).join('\n'),
    metadata: {
      name: doc.name,
      mime_type: doc.mime_type,
      folder_path: doc.folder_path,
      modified_at: doc.modified_at,
    },
  }));
}

/**
 * Build embedding inputs from briefings
 */
export function buildBriefingEmbeddingInputs(
  briefings: Array<{
    id: string;
    briefing_date?: string;
    content?: string;
    summary?: string;
  }>
): EmbeddingInput[] {
  return briefings.map((briefing) => ({
    sourceType: 'briefing' as SourceType,
    sourceId: briefing.id,
    content: [
      `Daily Briefing for ${briefing.briefing_date || 'Unknown date'}`,
      briefing.summary || '',
      briefing.content || '',
    ].join('\n'),
    metadata: {
      briefing_date: briefing.briefing_date,
    },
  }));
}
