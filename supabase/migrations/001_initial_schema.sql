-- ============================================================================
-- EmergentOS Phase 1 - Initial Database Schema
-- Version: 27.0 (Final)
-- Date: January 21, 2026
-- 
-- IMPORTANT: Run this in Supabase SQL Editor
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 2.1 connections - OAuth connection records
-- ============================================================================
CREATE TABLE IF NOT EXISTS connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,                          -- Clerk user ID
  provider TEXT NOT NULL,                         -- 'gmail' | 'calendar' | 'drive'
  connection_id TEXT NOT NULL,                    -- Nango connection ID
  status TEXT NOT NULL DEFAULT 'connected',       -- 'connected' | 'disconnected' | 'error'
  last_sync_at TIMESTAMPTZ,                       -- NULL until first successful sync
  metadata JSONB DEFAULT '{}',                    -- See structure in spec
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT connections_user_provider_unique UNIQUE (user_id, provider),
  CONSTRAINT connections_provider_check CHECK (provider IN ('gmail', 'calendar', 'drive')),
  CONSTRAINT connections_status_check CHECK (status IN ('connected', 'disconnected', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections (user_id);
CREATE INDEX IF NOT EXISTS idx_connections_status ON connections (user_id, status);

-- Enable RLS
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2.2 sync_jobs - Sync job tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  trigger TEXT NOT NULL,                          -- 'connect' | 'manual' | 'auto' | 'date_boundary'
  idempotency_key TEXT,                           -- For deduplication
  status TEXT NOT NULL DEFAULT 'pending',
  items_fetched INTEGER DEFAULT 0,
  items_inserted INTEGER DEFAULT 0,
  items_updated INTEGER DEFAULT 0,
  items_deleted INTEGER DEFAULT 0,
  time_changed BOOLEAN DEFAULT false,             -- Calendar only
  error_message TEXT,
  error_retryable BOOLEAN DEFAULT true,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  
  CONSTRAINT sync_jobs_provider_check CHECK (provider IN ('gmail', 'calendar', 'drive')),
  CONSTRAINT sync_jobs_trigger_check CHECK (trigger IN ('connect', 'manual', 'auto', 'date_boundary')),
  CONSTRAINT sync_jobs_status_check CHECK (status IN (
    'pending', 'fetching', 'securing', 'persisting', 
    'analyzing', 'embedding', 'complete', 'error'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_jobs_idempotency ON sync_jobs (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sync_jobs_user_provider_status ON sync_jobs (user_id, provider, status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_completed_at ON sync_jobs (completed_at);

-- Enable RLS
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2.3 emails - Gmail messages
-- ============================================================================
CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL,                       -- Gmail message ID
  thread_id TEXT,                                 -- Gmail thread ID for grouping
  sender TEXT NOT NULL,                           -- From header (may be tokenized)
  subject TEXT NOT NULL,                          -- Subject (may be tokenized)
  snippet TEXT,                                   -- Email preview text
  received_at TIMESTAMPTZ NOT NULL,               -- Email date (ISO format)
  is_read BOOLEAN DEFAULT true,                   -- Read status
  has_attachments BOOLEAN DEFAULT false,          -- Has attachments
  labels JSONB DEFAULT '[]',                      -- Gmail labels
  security_verified BOOLEAN DEFAULT false,        -- DLP scan completed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT emails_user_message_unique UNIQUE (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_emails_user_received ON emails (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_user_thread ON emails (user_id, thread_id);

-- Enable RLS
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2.4 calendar_events - Calendar events with conflict tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,                         -- Google Calendar event ID
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_all_day BOOLEAN NOT NULL DEFAULT false,
  location TEXT,
  attendees JSONB DEFAULT '[]',                   -- Array of attendee objects
  organizer TEXT,
  has_conflict BOOLEAN NOT NULL DEFAULT false,
  conflict_with TEXT[] DEFAULT '{}',              -- Array of conflicting event_ids
  security_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT calendar_events_user_event_unique UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_user_start ON calendar_events (user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_end ON calendar_events (user_id, end_time);
CREATE INDEX IF NOT EXISTS idx_calendar_events_conflicts ON calendar_events (user_id, has_conflict) WHERE has_conflict = true;

-- Enable RLS
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2.5 drive_documents - Drive file metadata
-- ============================================================================
CREATE TABLE IF NOT EXISTS drive_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  document_id TEXT NOT NULL,                      -- Google Drive file ID
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  folder_path TEXT,                               -- Resolved folder path
  modified_at TIMESTAMPTZ,
  web_view_link TEXT,
  md5_checksum TEXT,                              -- For change detection
  content_preview TEXT,                           -- First 1000 chars for text files
  security_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT drive_documents_user_doc_unique UNIQUE (user_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_drive_documents_user_modified ON drive_documents (user_id, modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_drive_documents_mime ON drive_documents (user_id, mime_type);

-- Enable RLS
ALTER TABLE drive_documents ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2.6 calendar_insights - LLM analysis results
-- ============================================================================
CREATE TABLE IF NOT EXISTS calendar_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,                   -- One insight per user
  content JSONB NOT NULL,                         -- Full LLM response
  conflicts_count INTEGER NOT NULL DEFAULT 0,
  focus_time_hours NUMERIC(4,1) DEFAULT 0,
  meeting_hours NUMERIC(4,1) DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_insights_generated ON calendar_insights (user_id, generated_at);

-- Enable RLS
ALTER TABLE calendar_insights ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2.7 briefings - Daily briefing content
-- ============================================================================
CREATE TABLE IF NOT EXISTS briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  briefing_date DATE NOT NULL,                    -- Date of the briefing (UTC date)
  content JSONB NOT NULL,                         -- Full LLM response
  generated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT briefings_user_date_unique UNIQUE (user_id, briefing_date)
);

CREATE INDEX IF NOT EXISTS idx_briefings_user_date ON briefings (user_id, briefing_date DESC);

-- Enable RLS
ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2.8 embeddings - Vector embeddings with pgvector
-- ============================================================================
CREATE TABLE IF NOT EXISTS embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL,                      -- 'email' | 'calendar' | 'drive' | 'briefing'
  source_id TEXT NOT NULL,                        -- External ID (message_id, event_id, etc.)
  content TEXT NOT NULL,                          -- Text that was embedded
  embedding vector(1536) NOT NULL,                -- OpenAI text-embedding-3-small
  metadata JSONB DEFAULT '{}',
  content_hash TEXT NOT NULL,                     -- SHA256 hex for deduplication
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT embeddings_user_source_unique UNIQUE (user_id, source_type, source_id),
  CONSTRAINT embeddings_source_type_check CHECK (source_type IN ('email', 'calendar', 'drive', 'briefing'))
);

CREATE INDEX IF NOT EXISTS idx_embeddings_user_type ON embeddings (user_id, source_type);
CREATE INDEX IF NOT EXISTS idx_embeddings_content_hash ON embeddings (user_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Full-text search index (required for hybridSearch keyword component)
CREATE INDEX IF NOT EXISTS idx_embeddings_content_fts ON embeddings USING GIN (to_tsvector('english', content));

-- Enable RLS
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2.9 pii_vault - Tokenized PII storage
-- ============================================================================
CREATE TABLE IF NOT EXISTS pii_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,                            -- e.g., [PERSON_001]
  original_value TEXT NOT NULL,                   -- Encrypted original
  detection_type TEXT NOT NULL,                   -- 'PERSON_NAME', 'EMAIL_ADDRESS', etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT pii_vault_user_token_unique UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_pii_vault_user ON pii_vault (user_id);
CREATE INDEX IF NOT EXISTS idx_pii_vault_token ON pii_vault (user_id, token);

-- Enable RLS
ALTER TABLE pii_vault ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- SQL Functions
-- ============================================================================

-- Vector similarity search function
CREATE OR REPLACE FUNCTION match_embeddings(
  query_embedding vector(1536),
  match_user_id TEXT,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  source_type TEXT,
  source_id TEXT,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.source_type,
    e.source_id,
    e.content,
    e.metadata,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM embeddings e
  WHERE e.user_id = match_user_id
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Orphaned embeddings cleanup function
CREATE OR REPLACE FUNCTION delete_orphaned_embeddings()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM embeddings e
    WHERE 
      -- Email embeddings: source_id = message_id (Gmail ID)
      (e.source_type = 'email' AND NOT EXISTS (
        SELECT 1 FROM emails WHERE message_id = e.source_id AND user_id = e.user_id
      ))
      OR
      -- Calendar embeddings: source_id = event_id (Google Calendar ID)
      (e.source_type = 'calendar' AND NOT EXISTS (
        SELECT 1 FROM calendar_events WHERE event_id = e.source_id AND user_id = e.user_id
      ))
      OR
      -- Drive embeddings: source_id = document_id (Google Drive ID)
      (e.source_type = 'drive' AND NOT EXISTS (
        SELECT 1 FROM drive_documents WHERE document_id = e.source_id AND user_id = e.user_id
      ))
      OR
      -- Briefing embeddings: source_id = id (Database UUID as text)
      (e.source_type = 'briefing' AND NOT EXISTS (
        SELECT 1 FROM briefings WHERE id::text = e.source_id AND user_id = e.user_id
      ))
    RETURNING *
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Done!
-- ============================================================================
