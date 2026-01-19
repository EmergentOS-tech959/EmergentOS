-- EmergentOS Phase 1 - Step 9: Calendar Insights (Time Sovereignty Pipeline)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS calendar_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  analysis_date DATE NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  conflicts JSONB DEFAULT '[]',
  conflicts_count INT DEFAULT 0,
  suggestions TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, analysis_date)
);

CREATE INDEX IF NOT EXISTS idx_calendar_insights_user_date ON calendar_insights(user_id, analysis_date DESC);

ALTER TABLE calendar_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own calendar insights" ON calendar_insights;
CREATE POLICY "Users can view own calendar insights" ON calendar_insights
  FOR SELECT USING (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can insert own calendar insights" ON calendar_insights;
CREATE POLICY "Users can insert own calendar insights" ON calendar_insights
  FOR INSERT WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Users can update own calendar insights" ON calendar_insights;
CREATE POLICY "Users can update own calendar insights" ON calendar_insights
  FOR UPDATE USING (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "Service role bypass for calendar insights" ON calendar_insights;
CREATE POLICY "Service role bypass for calendar insights" ON calendar_insights
  FOR ALL USING (current_setting('role', true) = 'service_role');

