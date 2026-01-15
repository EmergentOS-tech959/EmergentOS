-- ═══════════════════════════════════════════════════════════════
-- EmergentOS Phase 1 - Database Schema Migration
-- Version: 1.0.0
-- Date: 2026-01-15
-- NOTE: This is an UPGRADE migration from Phase 0
-- ═══════════════════════════════════════════════════════════════

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ═══════════════════════════════════════════════════════════════
-- UPGRADE EXISTING TABLES FROM PHASE 0
-- ═══════════════════════════════════════════════════════════════

-- Upgrade sync_status table - add new columns
ALTER TABLE sync_status 
  ADD COLUMN IF NOT EXISTS current_provider TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Upgrade emails table - add new columns for Phase 1
ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS thread_id TEXT,
  ADD COLUMN IF NOT EXISTS sender_email TEXT,
  ADD COLUMN IF NOT EXISTS snippet TEXT,
  ADD COLUMN IF NOT EXISTS body_preview TEXT,
  ADD COLUMN IF NOT EXISTS labels TEXT[],
  ADD COLUMN IF NOT EXISTS is_important BOOLEAN DEFAULT FALSE;

-- ═══════════════════════════════════════════════════════════════
-- NEW CORE TABLES
-- ═══════════════════════════════════════════════════════════════

-- User profiles and preferences
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT UNIQUE NOT NULL,
  display_name TEXT,
  email TEXT,
  preferences JSONB DEFAULT '{}',
  onboarding_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Integration connection status
CREATE TABLE IF NOT EXISTS connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  status TEXT DEFAULT 'connected',
  last_sync_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- ═══════════════════════════════════════════════════════════════
-- NEW DATA TABLES
-- ═══════════════════════════════════════════════════════════════

-- Calendar events
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  calendar_id TEXT DEFAULT 'primary',
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  location TEXT,
  attendees JSONB DEFAULT '[]',
  is_all_day BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'confirmed',
  has_conflict BOOLEAN DEFAULT FALSE,
  conflict_with TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, event_id)
);

-- Drive documents
CREATE TABLE IF NOT EXISTS drive_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT,
  folder_path TEXT,
  modified_at TIMESTAMPTZ,
  web_view_link TEXT,
  content_hash TEXT,
  is_context_folder BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, document_id)
);

-- ═══════════════════════════════════════════════════════════════
-- AI TABLES
-- ═══════════════════════════════════════════════════════════════

-- Daily briefings
CREATE TABLE IF NOT EXISTS briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  briefing_date DATE NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  key_priorities JSONB DEFAULT '[]',
  schedule_summary JSONB DEFAULT '{}',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  sources JSONB DEFAULT '[]',
  UNIQUE(user_id, briefing_date)
);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  session_id UUID NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  sources JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vector embeddings for RAG
CREATE TABLE IF NOT EXISTS embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- PII VAULT
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pii_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,
  original_value TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, token)
);

-- ═══════════════════════════════════════════════════════════════
-- ADMIN TABLES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- INDEXES FOR PERFORMANCE
-- ═══════════════════════════════════════════════════════════════

-- User profiles indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);

-- Connections indexes
CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);

-- Email indexes (for new columns)
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(user_id, thread_id);

-- Calendar indexes
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start_time ON calendar_events(user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_calendar_events_conflicts ON calendar_events(user_id, has_conflict) WHERE has_conflict = TRUE;

-- Drive indexes
CREATE INDEX IF NOT EXISTS idx_drive_documents_user_id ON drive_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_drive_documents_modified ON drive_documents(user_id, modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_drive_documents_context ON drive_documents(user_id, is_context_folder) WHERE is_context_folder = TRUE;

-- AI indexes
CREATE INDEX IF NOT EXISTS idx_briefings_user_date ON briefings(user_id, briefing_date DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id, created_at DESC);

-- Embeddings indexes
CREATE INDEX IF NOT EXISTS idx_embeddings_user_source ON embeddings(user_id, source_type);

-- PII vault indexes
CREATE INDEX IF NOT EXISTS idx_pii_vault_user_id ON pii_vault(user_id);
CREATE INDEX IF NOT EXISTS idx_pii_vault_token ON pii_vault(user_id, token);

-- Admin indexes
CREATE INDEX IF NOT EXISTS idx_admin_logs_user ON admin_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY ON NEW TABLES
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_logs ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- RLS POLICIES - Users can only access their own data
-- ═══════════════════════════════════════════════════════════════

-- User profiles policies
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT USING (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
CREATE POLICY "Users can insert own profile" ON user_profiles
  FOR INSERT WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE USING (user_id = current_setting('app.user_id', true));

-- Connections policies
DROP POLICY IF EXISTS "Users can view own connections" ON connections;
CREATE POLICY "Users can view own connections" ON connections
  FOR SELECT USING (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can insert own connections" ON connections;
CREATE POLICY "Users can insert own connections" ON connections
  FOR INSERT WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can update own connections" ON connections;
CREATE POLICY "Users can update own connections" ON connections
  FOR UPDATE USING (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can delete own connections" ON connections;
CREATE POLICY "Users can delete own connections" ON connections
  FOR DELETE USING (user_id = current_setting('app.user_id', true));

-- Calendar events policies
DROP POLICY IF EXISTS "Users can view own calendar events" ON calendar_events;
CREATE POLICY "Users can view own calendar events" ON calendar_events
  FOR SELECT USING (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can insert own calendar events" ON calendar_events;
CREATE POLICY "Users can insert own calendar events" ON calendar_events
  FOR INSERT WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can update own calendar events" ON calendar_events;
CREATE POLICY "Users can update own calendar events" ON calendar_events
  FOR UPDATE USING (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can delete own calendar events" ON calendar_events;
CREATE POLICY "Users can delete own calendar events" ON calendar_events
  FOR DELETE USING (user_id = current_setting('app.user_id', true));

-- Drive documents policies
DROP POLICY IF EXISTS "Users can view own drive documents" ON drive_documents;
CREATE POLICY "Users can view own drive documents" ON drive_documents
  FOR SELECT USING (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can insert own drive documents" ON drive_documents;
CREATE POLICY "Users can insert own drive documents" ON drive_documents
  FOR INSERT WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can update own drive documents" ON drive_documents;
CREATE POLICY "Users can update own drive documents" ON drive_documents
  FOR UPDATE USING (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can delete own drive documents" ON drive_documents;
CREATE POLICY "Users can delete own drive documents" ON drive_documents
  FOR DELETE USING (user_id = current_setting('app.user_id', true));

-- Briefings policies
DROP POLICY IF EXISTS "Users can view own briefings" ON briefings;
CREATE POLICY "Users can view own briefings" ON briefings
  FOR SELECT USING (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can insert own briefings" ON briefings;
CREATE POLICY "Users can insert own briefings" ON briefings
  FOR INSERT WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can update own briefings" ON briefings;
CREATE POLICY "Users can update own briefings" ON briefings
  FOR UPDATE USING (user_id = current_setting('app.user_id', true));

-- Chat messages policies
DROP POLICY IF EXISTS "Users can view own chat messages" ON chat_messages;
CREATE POLICY "Users can view own chat messages" ON chat_messages
  FOR SELECT USING (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can insert own chat messages" ON chat_messages;
CREATE POLICY "Users can insert own chat messages" ON chat_messages
  FOR INSERT WITH CHECK (user_id = current_setting('app.user_id', true));

-- Embeddings policies
DROP POLICY IF EXISTS "Users can view own embeddings" ON embeddings;
CREATE POLICY "Users can view own embeddings" ON embeddings
  FOR SELECT USING (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can insert own embeddings" ON embeddings;
CREATE POLICY "Users can insert own embeddings" ON embeddings
  FOR INSERT WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can delete own embeddings" ON embeddings;
CREATE POLICY "Users can delete own embeddings" ON embeddings
  FOR DELETE USING (user_id = current_setting('app.user_id', true));

-- PII vault policies
DROP POLICY IF EXISTS "Users can view own pii vault" ON pii_vault;
CREATE POLICY "Users can view own pii vault" ON pii_vault
  FOR SELECT USING (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can insert own pii vault" ON pii_vault;
CREATE POLICY "Users can insert own pii vault" ON pii_vault
  FOR INSERT WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can delete own pii vault" ON pii_vault;
CREATE POLICY "Users can delete own pii vault" ON pii_vault
  FOR DELETE USING (user_id = current_setting('app.user_id', true));

-- Admin logs - service role only
DROP POLICY IF EXISTS "Service role can manage admin logs" ON admin_logs;
CREATE POLICY "Service role can manage admin logs" ON admin_logs
  FOR ALL USING (true);

-- ═══════════════════════════════════════════════════════════════
-- SERVICE ROLE BYPASS POLICIES (for Inngest background functions)
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Service role bypass for user_profiles" ON user_profiles;
CREATE POLICY "Service role bypass for user_profiles" ON user_profiles
  FOR ALL USING (current_setting('role', true) = 'service_role');

DROP POLICY IF EXISTS "Service role bypass for connections" ON connections;
CREATE POLICY "Service role bypass for connections" ON connections
  FOR ALL USING (current_setting('role', true) = 'service_role');

DROP POLICY IF EXISTS "Service role bypass for sync_status" ON sync_status;
CREATE POLICY "Service role bypass for sync_status" ON sync_status
  FOR ALL USING (current_setting('role', true) = 'service_role');

DROP POLICY IF EXISTS "Service role bypass for emails" ON emails;
CREATE POLICY "Service role bypass for emails" ON emails
  FOR ALL USING (current_setting('role', true) = 'service_role');

DROP POLICY IF EXISTS "Service role bypass for calendar_events" ON calendar_events;
CREATE POLICY "Service role bypass for calendar_events" ON calendar_events
  FOR ALL USING (current_setting('role', true) = 'service_role');

DROP POLICY IF EXISTS "Service role bypass for drive_documents" ON drive_documents;
CREATE POLICY "Service role bypass for drive_documents" ON drive_documents
  FOR ALL USING (current_setting('role', true) = 'service_role');

DROP POLICY IF EXISTS "Service role bypass for briefings" ON briefings;
CREATE POLICY "Service role bypass for briefings" ON briefings
  FOR ALL USING (current_setting('role', true) = 'service_role');

DROP POLICY IF EXISTS "Service role bypass for chat_messages" ON chat_messages;
CREATE POLICY "Service role bypass for chat_messages" ON chat_messages
  FOR ALL USING (current_setting('role', true) = 'service_role');

DROP POLICY IF EXISTS "Service role bypass for embeddings" ON embeddings;
CREATE POLICY "Service role bypass for embeddings" ON embeddings
  FOR ALL USING (current_setting('role', true) = 'service_role');

DROP POLICY IF EXISTS "Service role bypass for pii_vault" ON pii_vault;
CREATE POLICY "Service role bypass for pii_vault" ON pii_vault
  FOR ALL USING (current_setting('role', true) = 'service_role');

-- ═══════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers (drop first to avoid errors on re-run)
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_connections_updated_at ON connections;
CREATE TRIGGER update_connections_updated_at
  BEFORE UPDATE ON connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_calendar_events_updated_at ON calendar_events;
CREATE TRIGGER update_calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════
-- VECTOR SEARCH FUNCTION
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION match_embeddings(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_user_id text,
  filter_source_types text[]
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
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.source_type,
    e.source_id,
    e.content,
    e.metadata,
    1 - (e.embedding <=> query_embedding) as similarity
  FROM embeddings e
  WHERE e.user_id = filter_user_id
    AND e.source_type = ANY(filter_source_types)
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- MIGRATION COMPLETE
-- ═══════════════════════════════════════════════════════════════
