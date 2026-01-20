-- ═══════════════════════════════════════════════════════════════════════════
-- EmergentOS Phase 1: Embeddings & Search Infrastructure
-- Migration: 20260119_embeddings_search.sql
-- 
-- This migration sets up:
-- 1. pgvector extension for vector similarity search
-- 2. embeddings table for storing text embeddings
-- 3. match_embeddings RPC function for semantic search
-- 4. Indexes for efficient search
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable pgvector extension (required for vector similarity search)
CREATE EXTENSION IF NOT EXISTS vector;

-- ═══════════════════════════════════════════════════════════════════════════
-- EMBEDDINGS TABLE
-- ═══════════════════════════════════════════════════════════════════════════

-- Create embeddings table if not exists
CREATE TABLE IF NOT EXISTS embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL,  -- 'email', 'calendar', 'drive', 'briefing'
  source_id UUID NOT NULL,     -- FK to source table
  content TEXT NOT NULL,       -- Text that was embedded (truncated for storage)
  metadata JSONB DEFAULT '{}', -- { title, date, sender, etc. }
  embedding vector(1536),      -- OpenAI text-embedding-3-small dimension
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add column if table exists but embedding column missing
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'embeddings' AND column_name = 'embedding'
  ) THEN
    ALTER TABLE embeddings ADD COLUMN embedding vector(1536);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════

-- Index for filtering by user
CREATE INDEX IF NOT EXISTS embeddings_user_id_idx ON embeddings(user_id);

-- Index for filtering by source type
CREATE INDEX IF NOT EXISTS embeddings_source_type_idx ON embeddings(source_type);

-- Composite index for common query pattern
CREATE INDEX IF NOT EXISTS embeddings_user_source_idx ON embeddings(user_id, source_type);

-- Unique constraint to prevent duplicate embeddings
CREATE UNIQUE INDEX IF NOT EXISTS embeddings_user_source_id_idx ON embeddings(user_id, source_id);

-- Vector similarity index using IVFFlat
-- Note: Requires at least 100 rows to be effective; falls back to sequential scan otherwise
DROP INDEX IF EXISTS embeddings_embedding_idx;
CREATE INDEX embeddings_embedding_idx ON embeddings 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ═══════════════════════════════════════════════════════════════════════════
-- MATCH EMBEDDINGS FUNCTION
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop existing function if exists (to update signature)
DROP FUNCTION IF EXISTS match_embeddings(vector, float, int, text, text[]);

-- Create the match_embeddings function for semantic search
CREATE OR REPLACE FUNCTION match_embeddings(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.65,
  match_count int DEFAULT 10,
  filter_user_id text DEFAULT NULL,
  filter_source_types text[] DEFAULT ARRAY['email', 'calendar', 'drive', 'briefing']
)
RETURNS TABLE (
  id uuid,
  source_type text,
  source_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.source_type,
    e.source_id,
    e.content,
    e.metadata,
    (1 - (e.embedding <=> query_embedding))::float AS similarity
  FROM embeddings e
  WHERE 
    (filter_user_id IS NULL OR e.user_id = filter_user_id)
    AND e.source_type = ANY(filter_source_types)
    AND e.embedding IS NOT NULL
    AND (1 - (e.embedding <=> query_embedding)) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION match_embeddings TO authenticated;
GRANT EXECUTE ON FUNCTION match_embeddings TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable RLS on embeddings table
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own embeddings
DROP POLICY IF EXISTS "Users can access own embeddings" ON embeddings;
CREATE POLICY "Users can access own embeddings" ON embeddings
  FOR ALL
  USING (user_id = current_setting('app.user_id', true));

-- Policy for service role (full access)
DROP POLICY IF EXISTS "Service role full access embeddings" ON embeddings;
CREATE POLICY "Service role full access embeddings" ON embeddings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTION: Delete embeddings by source
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION delete_embeddings_for_source(
  p_user_id text,
  p_source_type text DEFAULT NULL,
  p_source_ids uuid[] DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count int;
BEGIN
  IF p_source_ids IS NOT NULL AND array_length(p_source_ids, 1) > 0 THEN
    DELETE FROM embeddings
    WHERE user_id = p_user_id
      AND (p_source_type IS NULL OR source_type = p_source_type)
      AND source_id = ANY(p_source_ids);
  ELSIF p_source_type IS NOT NULL THEN
    DELETE FROM embeddings
    WHERE user_id = p_user_id
      AND source_type = p_source_type;
  ELSE
    DELETE FROM embeddings
    WHERE user_id = p_user_id;
  END IF;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION delete_embeddings_for_source TO authenticated;
GRANT EXECUTE ON FUNCTION delete_embeddings_for_source TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- COMMENTS
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE embeddings IS 'Vector embeddings for semantic search (RAG)';
COMMENT ON COLUMN embeddings.source_type IS 'Type of source: email, calendar, drive, briefing';
COMMENT ON COLUMN embeddings.source_id IS 'UUID of the source record in its respective table';
COMMENT ON COLUMN embeddings.content IS 'Truncated text content that was embedded';
COMMENT ON COLUMN embeddings.embedding IS 'OpenAI text-embedding-3-small vector (1536 dimensions)';
COMMENT ON FUNCTION match_embeddings IS 'Semantic search using cosine similarity with pgvector';
