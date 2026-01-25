# EmergentOS: Complete Data Lifecycle Specification

**Version:** 27.0 (Final)  
**Date:** January 21, 2026  
**Status:** Production-Ready Specification  
**Purpose:** Build backend logic from scratch (UI code only exists)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema](#2-database-schema)
3. [Time Boundaries](#3-time-boundaries)
4. [Sync Triggers and Behaviors](#4-sync-triggers-and-behaviors)
5. [Connection Flow: Initial Connect](#5-connection-flow-initial-connect)
6. [Connection Flow: Disconnect](#6-connection-flow-disconnect)
7. [Inngest Sync Functions](#7-inngest-sync-functions)
8. [API Routes](#8-api-routes)
9. [LLM Prompts](#9-llm-prompts)
10. [Inngest Cron Jobs](#10-inngest-cron-jobs)
11. [Client: SyncManager Specification](#11-client-syncmanager-specification)
12. [OAuth Scopes Required](#12-oauth-scopes-required)
13. [Provider Config Key Mapping](#13-provider-config-key-mapping)
14. [Error Classification](#14-error-classification)
15. [Verification Checklist](#15-verification-checklist)
16. [Helper Functions](#16-helper-functions)
17. [Type Definitions](#17-type-definitions)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                                    │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                      SyncManager (React Context)                           │  │
│  │  • Manages provider connection states (gmail, calendar, drive)            │  │
│  │  • 10-minute wall-clock aligned auto-sync (:00, :10, :20, :30, :40, :50)  │  │
│  │  • DATE BOUNDARY DETECTION: Re-analyze at midnight UTC                    │  │
│  │  • EVENT IMMINENCE: Check events starting within 30 minutes               │  │
│  │  • FIFO queue with deduplication (max 3 pending requests)                 │  │
│  │  • Dispatches CustomEvents for UI updates                                 │  │
│  │  • On connect: POLLS for completion, then generates briefing              │  │
│  │  • On disconnect: Calls API, waits for briefing, updates state            │  │
│  │  • On manual/auto: Enqueues sync, waits for response                      │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                       │                                          │
│                                       ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                      Dashboard Components                                  │  │
│  │  • DailyBriefing: Listens for eos:connections-updated, fetches briefing   │  │
│  │  • ScheduleWidget: Listens for eos:connections-updated, fetches events    │  │
│  │  • UnifiedRefreshButton: Calls syncAll() on SyncManager                   │  │
│  │  • OmniPanel (Chat): Uses hybrid search + Gemini LLM                      │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ HTTPS
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              SERVER (Next.js API Routes)                         │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  /api/connections                 GET: List all connections for user       │  │
│  │  /api/integrations/{provider}/sync    POST: Trigger sync, poll for result │  │
│  │  /api/integrations/{provider}/disconnect  POST: Remove connection + data  │  │
│  │  /api/ai/briefing/generate        POST: Generate briefing on-demand        │  │
│  │  /api/ai/briefing/[date]          GET: Fetch briefing for date            │  │
│  │  /api/ai/chat                     POST: RAG chat with streaming            │  │
│  │  /api/calendar/imminent           GET: Check for imminent events           │  │
│  │  /api/nango/webhook               POST: Receive Nango connection events    │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ Inngest Events
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              INNGEST (Background Processing)                     │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  processGmailSync:     Fetch emails → DLP → Persist → Embed               │  │
│  │  processCalendarSync:  Fetch events → DLP → Persist → Analyze → Embed     │  │
│  │  processDriveSync:     Fetch files → DLP → Persist → Embed                │  │
│  │  generateDailyBriefingCron:  6 AM UTC → All users with connections        │  │
│  │  cleanupOldDataCron:   3 AM UTC → Delete old data + orphaned embeddings   │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│     SUPABASE         │  │       NANGO          │  │   EXTERNAL APIS      │
│  • connections       │  │  • OAuth tokens      │  │  • Gmail API         │
│  • emails            │  │  • Proxy to Google   │  │  • Calendar API      │
│  • calendar_events   │  │  • Token refresh     │  │  • Drive API         │
│  • drive_documents   │  │                      │  │  • Nightfall DLP     │
│  • calendar_insights │  └──────────────────────┘  │  • OpenAI Embeddings │
│  • briefings         │                            │  • Gemini LLM        │
│  • embeddings        │                            └──────────────────────┘
│  • sync_jobs         │
│  • pii_vault         │
└──────────────────────┘
```

---

## 2. Database Schema

> **⚠️ SECURITY NOTE:** All tables require Row Level Security (RLS) policies. Since this system uses Clerk authentication (not Supabase Auth), RLS is enforced via service role on server-side only:
> ```sql
> ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;
> -- Server uses service role key which bypasses RLS
> -- All user data filtering happens in application code via user_id from Clerk
> ```
> **IMPORTANT:** Client-side queries (e.g., `checkImminentEvents` in SyncManager) must go through API routes that validate the Clerk session and filter by user_id. The SyncManager should call `/api/calendar/imminent` instead of querying Supabase directly.

### 2.1 `connections`

```sql
CREATE TABLE connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,                          -- Clerk user ID
  provider TEXT NOT NULL,                         -- 'gmail' | 'calendar' | 'drive'
  connection_id TEXT NOT NULL,                    -- Nango connection ID
  status TEXT NOT NULL DEFAULT 'connected',       -- 'connected' | 'disconnected' | 'error'
  last_sync_at TIMESTAMPTZ,                       -- NULL until first successful sync
  metadata JSONB DEFAULT '{}',                    -- See structure below
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT connections_user_provider_unique UNIQUE (user_id, provider),
  CONSTRAINT connections_provider_check CHECK (provider IN ('gmail', 'calendar', 'drive')),
  CONSTRAINT connections_status_check CHECK (status IN ('connected', 'disconnected', 'error'))
);

CREATE INDEX idx_connections_user_id ON connections (user_id);
CREATE INDEX idx_connections_status ON connections (user_id, status);
```

**metadata structure:**
```json
{
  "clerk_user_id": "user_xxx",
  "syncToken": "CAxxxxx",          // Calendar only, NULL on initial
  "error_reason": "Token expired"  // Only when status='error'
}
```

**CRITICAL RULES:**
- `last_sync_at = NULL` means sync never completed successfully
- `status = 'error'` triggers "Reconnect required" message in UI
- On reconnect: `last_sync_at` is reset to NULL for fresh initial sync

---

### 2.2 `sync_jobs`

```sql
CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  trigger TEXT NOT NULL,                          -- 'connect' | 'manual' | 'auto' | 'date_boundary'
  idempotency_key TEXT,                           -- For deduplication
  status TEXT NOT NULL DEFAULT 'pending',
  items_fetched INTEGER DEFAULT 0,
  items_inserted INTEGER DEFAULT 0,
  items_updated INTEGER DEFAULT 0,                 -- Note: UPSERT makes this hard to track; use 0
  items_deleted INTEGER DEFAULT 0,
  time_changed BOOLEAN DEFAULT false,             -- Calendar only: events passed/became urgent
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

CREATE UNIQUE INDEX idx_sync_jobs_idempotency ON sync_jobs (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_sync_jobs_user_provider_status ON sync_jobs (user_id, provider, status);
CREATE INDEX idx_sync_jobs_completed_at ON sync_jobs (completed_at);
```

---

### 2.3 `emails`

```sql
CREATE TABLE emails (
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

CREATE INDEX idx_emails_user_received ON emails (user_id, received_at DESC);
CREATE INDEX idx_emails_user_thread ON emails (user_id, thread_id);
```

---

### 2.4 `calendar_events`

```sql
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,                         -- Google Calendar event ID
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_all_day BOOLEAN NOT NULL DEFAULT false,
  location TEXT,
  attendees JSONB DEFAULT '[]',                   -- See structure below
  organizer TEXT,
  has_conflict BOOLEAN NOT NULL DEFAULT false,
  conflict_with TEXT[] DEFAULT '{}',              -- Array of conflicting event_ids
  security_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT calendar_events_user_event_unique UNIQUE (user_id, event_id)
);

CREATE INDEX idx_calendar_events_user_start ON calendar_events (user_id, start_time);
CREATE INDEX idx_calendar_events_user_end ON calendar_events (user_id, end_time);
CREATE INDEX idx_calendar_events_conflicts ON calendar_events (user_id, has_conflict) WHERE has_conflict = true;
```

**attendees structure:**
```json
[
  {
    "email": "person@example.com",
    "displayName": "Person Name",
    "responseStatus": "accepted",
    "organizer": false,
    "self": false
  }
]
```

---

### 2.5 `drive_documents`

```sql
CREATE TABLE drive_documents (
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

CREATE INDEX idx_drive_documents_user_modified ON drive_documents (user_id, modified_at DESC);
CREATE INDEX idx_drive_documents_mime ON drive_documents (user_id, mime_type);
```

---

### 2.6 `calendar_insights`

```sql
CREATE TABLE calendar_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,                   -- One insight per user
  content JSONB NOT NULL,                         -- Full LLM response (see schema below)
  -- Denormalized fields for quick queries:
  conflicts_count INTEGER NOT NULL DEFAULT 0,     -- Extracted from content.metrics.conflictCount
  focus_time_hours NUMERIC(4,1) DEFAULT 0,        -- Extracted from content.metrics.focusHoursAvailable
  meeting_hours NUMERIC(4,1) DEFAULT 0,           -- Extracted from content.metrics.meetingHoursTotal
  generated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_calendar_insights_generated ON calendar_insights (user_id, generated_at);

-- Content JSONB schema (matches LLM response in Section 9.3):
-- {
--   "executiveSummary": string,
--   "urgentActions": [{ "priority": number, "action": string, "reason": string, "timeframe": string }],
--   "conflictResolutions": [{ "conflictingEvents": string[], "recommendation": string, "suggestedAction": string }],
--   "delegationOpportunities": [{ "meeting": string, "reason": string, "suggestedDelegate": string }],
--   "focusTimeProtection": { "availableHours": number, "recommendation": string, "suggestedBlocks": string[] },
--   "weeklyInsights": { "meetingLoad": string, "balanceScore": number, "topConcern": string },
--   "metrics": { "meetingHoursTotal": number, "focusHoursAvailable": number, "conflictCount": number, "backToBackCount": number }
-- }
```

---

### 2.7 `briefings`

```sql
CREATE TABLE briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  briefing_date DATE NOT NULL,                    -- Date of the briefing (UTC date)
  content JSONB NOT NULL,                         -- Full LLM response (see schema below)
  generated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT briefings_user_date_unique UNIQUE (user_id, briefing_date)
);

-- Content JSONB schema (matches LLM response in Section 9.4):
-- {
--   "executiveSummary": string,
--   "topPriority": { "item": string, "reason": string, "suggestedAction": string },
--   "urgentAttention": [{ "type": string, "item": string, "action": string, "deadline": string }],
--   "scheduleInsight": { "meetingCount": number, "totalMeetingHours": number, ... },
--   "actionItems": [{ "task": string, "source": string, "priority": string, ... }],
--   "intelligence": { "emailHighlights": string[], ... },
--   "closingNote": string
-- }

CREATE INDEX idx_briefings_user_date ON briefings (user_id, briefing_date DESC);
```

**data_sources structure:**
```json
{
  "gmail": { "connected": true, "emailCount": 15 },
  "calendar": { "connected": true, "eventCount": 8 },
  "drive": { "connected": false, "documentCount": 0 }
}
```

**CRITICAL: Briefing Date Calculation**
```typescript
// Always use UTC date for briefing_date
const briefingDate = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD' in UTC
```

---

### 2.8 `embeddings`

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL,                      -- 'email' | 'calendar' | 'drive' | 'briefing'
  source_id TEXT NOT NULL,                        -- Source identifier (see SOURCE_ID MAPPING below)
  content TEXT NOT NULL,                          -- Text that was embedded
  embedding vector(1536) NOT NULL,                -- OpenAI text-embedding-3-small
  metadata JSONB DEFAULT '{}',
  content_hash TEXT NOT NULL,                     -- SHA256 hex for deduplication
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT embeddings_user_source_unique UNIQUE (user_id, source_type, source_id),
  CONSTRAINT embeddings_source_type_check CHECK (source_type IN ('email', 'calendar', 'drive', 'briefing'))
);

CREATE INDEX idx_embeddings_user_type ON embeddings (user_id, source_type);
CREATE INDEX idx_embeddings_content_hash ON embeddings (user_id, content_hash);
CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Full-text search index (required for hybridSearch keyword component)
CREATE INDEX idx_embeddings_content_fts ON embeddings USING GIN (to_tsvector('english', content));
```

**SOURCE_ID MAPPING (CRITICAL - Uses External IDs, NOT Database UUIDs):**

| source_type | source_id value | Example |
|-------------|-----------------|---------|
| `'email'` | `emails.message_id` (Gmail ID) | `"19bd7ec00c1787f2"` |
| `'calendar'` | `calendar_events.event_id` (Google ID) | `"abc123xyz789"` |
| `'drive'` | `drive_documents.document_id` (Google ID) | `"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"` |
| `'briefing'` | `briefings.id` (Database UUID) | `"550e8400-e29b-41d4-a716-446655440000"` |

**SOURCE_TYPE MAPPING (Content Templates):**

| Provider | source_type | Content Template |
|----------|-------------|------------------|
| gmail | `'email'` | `"Email from {sender}: {subject}\n{snippet}"` |
| calendar | `'calendar'` | `"Event: {title} on {date}\nLocation: {location}\n{description}"` |
| drive | `'drive'` | `"Document: {name} ({mime_type})\n{content_preview}"` |
| briefing | `'briefing'` | `"{summary}\n{priorities}"` |

---

### 2.9 `pii_vault`

```sql
CREATE TABLE pii_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,                            -- e.g., [PERSON_001]
  original_value TEXT NOT NULL,                   -- Encrypted original
  detection_type TEXT NOT NULL,                   -- 'PERSON_NAME', 'EMAIL_ADDRESS', etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT pii_vault_user_token_unique UNIQUE (user_id, token)
);

CREATE INDEX idx_pii_vault_user ON pii_vault (user_id);
CREATE INDEX idx_pii_vault_token ON pii_vault (user_id, token);
```

---

## 3. Time Boundaries

All time operations use **UTC**.

### 3.1 Time Calculation Functions

```typescript
function startOfDayUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfDayUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function daysAgoUTC(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - days,
    0, 0, 0, 0
  ));
}

function daysFromNowUTC(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + days,
    23, 59, 59, 999
  ));
}

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function getCurrentUTCDate(): string {
  return new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
}
```

### 3.2 Gmail Time Boundaries

| Operation | From | To | Implementation |
|-----------|------|----|----------------|
| **Initial Sync** | 7 days ago 00:00:00 UTC | Current moment | `in:inbox after:${toUnixSeconds(daysAgoUTC(7))}` |
| **Delta Sync** | `last_sync_at` (exact) | Current moment | `in:inbox after:${toUnixSeconds(new Date(last_sync_at))}` |
| **Briefing Query** | Yesterday 00:00:00 UTC | Current moment | `WHERE received_at >= '${daysAgoUTC(1).toISOString()}'` |
| **Data Retention** | 30 days | - | Delete where `received_at < daysAgoUTC(30)` |

> **⚠️ CRITICAL:** Gmail `after:` uses Unix SECONDS, not milliseconds!

> **⚠️ DELTA SYNC NOTE:** Due to Unix seconds precision, emails arriving in the same second as `last_sync_at` may be fetched again. Use UPSERT with `ON CONFLICT DO NOTHING` or `DO UPDATE` to handle duplicates gracefully.

### 3.3 Calendar Time Boundaries

| Operation | From | To | Implementation |
|-----------|------|----|----------------|
| **Initial Sync** | 7 days ago 00:00:00 UTC | 30 days from now 23:59:59 UTC | `timeMin=${ISO}` `timeMax=${ISO}` |
| **Delta Sync** | N/A | N/A | Uses `syncToken` (returns ALL changes) |
| **Briefing Query** | Today 00:00:00 UTC | Tomorrow 23:59:59 UTC | See multi-day query below |
| **Analysis Window** | 7 days ago 00:00:00 UTC | 14 days from now 23:59:59 UTC | DB query |
| **Data Retention** | End time + 30 days | - | Delete where `end_time < daysAgoUTC(30)` |

**Multi-day Event Briefing Query:**
```sql
SELECT * FROM calendar_events
WHERE user_id = :userId
  AND start_time <= :tomorrowEndUTC    -- Event starts before tomorrow ends
  AND end_time >= :todayStartUTC       -- Event ends after today starts
ORDER BY start_time ASC
```

**Time Variable Calculation:**
```typescript
const now = new Date();
const todayStartUTC = startOfDayUTC(now).toISOString();
const tomorrowEndUTC = endOfDayUTC(new Date(now.getTime() + 24*60*60*1000)).toISOString();
```

### 3.4 Drive Time Boundaries

| Operation | From | To | Implementation |
|-----------|------|----|----------------|
| **Initial Sync** | 14 days ago 00:00:00 UTC | Current moment | `modifiedTime > '${ISO}' and trashed = false` |
| **Delta Sync** | `last_sync_at` (exact) | Current moment | `modifiedTime > '${last_sync_at}' and trashed = false` |
| **Briefing Query** | Yesterday 00:00:00 UTC | Current moment | `WHERE modified_at >= '${daysAgoUTC(1).toISOString()}'` |
| **Data Retention** | 30 days | - | Delete where `modified_at < daysAgoUTC(30)` |

---

## 4. Sync Triggers and Behaviors

### 4.1 Trigger Types

| Trigger | Source | How Initiated |
|---------|--------|---------------|
| `connect` | Nango webhook | User completes OAuth in popup |
| `manual` | Unified Refresh Button | User clicks refresh in dashboard |
| `auto` | SyncManager timer | 10-minute wall-clock intervals |
| `date_boundary` | SyncManager | Midnight UTC crossing detected |

> **NOTE:** `imminent_event` is handled client-side only (no sync, just notification).

### 4.2 What Each Trigger Does

| Trigger | Sync Type | Regenerate Briefing | Run Analysis | Generate Embeddings |
|---------|-----------|---------------------|--------------|---------------------|
| `connect` | Initial (full fetch) | ✅ ALWAYS | ✅ ALWAYS | ✅ ALWAYS |
| `manual` | Delta | ✅ ALWAYS | ✅ ALWAYS | ✅ ALWAYS |
| `auto` | Delta | ⚠️ IF dataChanged OR timeChanged | ⚠️ IF dataChanged OR timeChanged | ⚠️ IF dataChanged |
| `date_boundary` | Delta | ✅ ALWAYS (new day) | ✅ ALWAYS | ⚠️ IF dataChanged |

### 4.3 dataChanged Calculation

```typescript
// CRITICAL: Use DATABASE counts, not API fetch counts

async function calculateDataChanged(
  userId: string,
  table: string,
  persistFn: () => Promise<void>
): Promise<{ itemsInserted: number; dataChanged: boolean }> {
  // Before persist
  const { count: beforeCount } = await db
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  // Persist data with UPSERT
  await persistFn();

  // After persist
  const { count: afterCount } = await db
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  // Calculate changes
  const itemsInserted = Math.max(0, (afterCount || 0) - (beforeCount || 0));
  const dataChanged = itemsInserted > 0;

  return { itemsInserted, dataChanged };
}

// For calendar with deletions:
const dataChanged = itemsInserted > 0 || itemsDeleted > 0;
```

### 4.4 Time-Based Change Detection (Calendar)

```typescript
interface CalendarChangeDetection {
  dataChanged: boolean;
  timeChanged: boolean;
  reason: string;
}

async function calculateCalendarDataChanged(
  userId: string, 
  lastSyncAt: Date | null,
  itemsInserted: number,
  itemsDeleted: number
): Promise<CalendarChangeDetection> {
  const now = new Date();
  const todayStartUTC = startOfDayUTC(now);
  
  // 1. Check if date boundary crossed since last sync
  if (lastSyncAt) {
    const lastSyncDayUTC = startOfDayUTC(lastSyncAt);
    if (todayStartUTC.getTime() > lastSyncDayUTC.getTime()) {
      return {
        dataChanged: itemsInserted > 0 || itemsDeleted > 0,
        timeChanged: true,
        reason: 'Date boundary crossed - new calendar day in UTC'
      };
    }
  }
  
  // 2. Check for events that have PASSED since last sync
  if (lastSyncAt) {
    const { count: eventsPassed } = await db
      .from('calendar_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('end_time', lastSyncAt.toISOString())
      .lte('end_time', now.toISOString());
    
    if ((eventsPassed || 0) > 0) {
      return {
        dataChanged: itemsInserted > 0 || itemsDeleted > 0,
        timeChanged: true,
        reason: `${eventsPassed} event(s) have ended since last sync`
      };
    }
  }
  
  // 3. Check for events that have NEWLY entered the 24-hour window
  // An event has "become urgent" if:
  //   - It is NOW within 24 hours (start_time <= now + 24h)
  //   - It was NOT within 24 hours at last sync (start_time > lastSyncAt + 24h)
  const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (lastSyncAt) {
    const was24hThreshold = new Date(lastSyncAt.getTime() + 24 * 60 * 60 * 1000);
    const { count: eventsNowUrgent } = await db
      .from('calendar_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('start_time', was24hThreshold.toISOString())   // Was NOT urgent at last sync
      .lte('start_time', in24Hours.toISOString());       // IS urgent now
    
    if ((eventsNowUrgent || 0) > 0) {
      return {
        dataChanged: itemsInserted > 0 || itemsDeleted > 0,
        timeChanged: true,
        reason: `${eventsNowUrgent} event(s) newly entered 24-hour urgent window`
      };
    }
  }
  
  // 4. Standard data-based change detection only
  return {
    dataChanged: itemsInserted > 0 || itemsDeleted > 0,
    timeChanged: false,
    reason: itemsInserted > 0 || itemsDeleted > 0 
      ? `${itemsInserted} inserted, ${itemsDeleted} deleted`
      : 'No changes detected'
  };
}
```

---

## 5. Connection Flow: Initial Connect

```
STEP 1: USER clicks "Connect {Provider}" button
├── UI sets provider state to { pending: true }
├── Call Nango.create().auth(providerConfigKey, { user_id: clerkUserId })
└── OAuth popup opens

STEP 2: USER grants permission in OAuth popup
├── Nango stores OAuth tokens
├── Nango triggers webhook to /api/nango/webhook
└── Popup closes automatically

STEP 3A: WEBHOOK (Server)
├── Validate webhook signature (if configured)
├── Extract connectionId, providerConfigKey, endUser.id
├── Map providerConfigKey to provider name
├── UPSERT connection with last_sync_at = NULL (CRITICAL: NOT current time!)
├── CREATE sync_job with trigger='connect', status='pending'
├── Send Inngest event: '{provider}/sync.requested' with jobId
└── Return { received: true }

STEP 3B: CLIENT detects popup closed
├── Start polling GET /api/connections every 1s
├── Check for: lastSyncAt IS NOT NULL (sync complete indicator)
├── Show "Syncing..." in UI
└── Timeout: 120 seconds

STEP 4: INNGEST processes sync
├── Fetch sync_job by jobId (already created by webhook/API)
├── Fetch ALL data within time boundaries (paginated)
├── DLP scan with Nightfall (batched, with retry)
├── Persist to database with UPSERT
├── [Calendar only] Run analysis with Gemini
├── Generate embeddings with OpenAI
├── Update connection.last_sync_at = now() (ONLY after success!)
└── Mark sync_job status='complete'

STEP 5: CLIENT detects sync complete
├── Poll sees lastSyncAt is now NOT NULL
├── Stop polling
├── Update local state
├── Generate briefing: POST /api/ai/briefing/generate
├── Dispatch event: eos:connections-updated
└── Show success toast
```

### 5.1 Webhook Validation

```typescript
export async function POST(request: Request) {
  const signature = request.headers.get('x-nango-signature');
  if (process.env.NANGO_WEBHOOK_SECRET && signature) {
    const body = await request.text();
    const expectedSig = crypto
      .createHmac('sha256', process.env.NANGO_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');
    if (signature !== expectedSig) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }
  // Continue processing...
}
```

### 5.2 Webhook Connection UPSERT (CRITICAL)

```typescript
// CORRECT: last_sync_at = NULL
const { data: connection } = await db
  .from('connections')
  .upsert({
    user_id: userId,
    provider: provider,
    connection_id: connectionId,
    status: 'connected',
    last_sync_at: null,  // ← CRITICAL: NULL, not current time!
    metadata: { clerk_user_id: clerkUserId },
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,provider' })
  .select()
  .single();

// WRONG: This would cause delta sync to miss data!
// last_sync_at: new Date().toISOString()  // ← NEVER DO THIS
```

### 5.3 Webhook Sync Job Creation & Event Dispatch

```typescript
// Create sync job BEFORE sending Inngest event
const jobId = crypto.randomUUID();
const idempotencyKey = `connect-${userId}-${provider}-${Date.now()}`;

await db
  .from('sync_jobs')
  .insert({
    id: jobId,
    user_id: userId,
    provider,
    trigger: 'connect',
    idempotency_key: idempotencyKey,
    status: 'pending'
  });

// Send Inngest event with jobId
await inngest.send({
  name: `${provider}/sync.requested`,
  data: {
    userId,
    connectionId: connection.id,
    trigger: 'connect',
    idempotencyKey,
    jobId
  }
});

return NextResponse.json({ received: true });
```

---

## 6. Connection Flow: Disconnect

```
POST /api/integrations/{provider}/disconnect

1. Authenticate user (Clerk)

2. Find connection:
   SELECT connection_id FROM connections
   WHERE user_id = :userId AND provider = :provider

3. If not found: Return { success: true } (already disconnected)

4. Delete from Nango (graceful failure):
   try { 
     await nango.deleteConnection(
       PROVIDER_CONFIG_KEYS[provider],  // e.g., 'google-mail'
       connection_id                     // Nango connection ID from connections table
     );
   }
   catch (e) { console.warn('Nango delete failed:', e) }

5. Delete local data (TRANSACTION):
   BEGIN;
   DELETE FROM connections WHERE user_id = :userId AND provider = :provider;
   
   -- Provider-specific data:
   IF provider = 'gmail':
     DELETE FROM emails WHERE user_id = :userId;
     DELETE FROM embeddings WHERE user_id = :userId AND source_type = 'email';
   
   IF provider = 'calendar':
     DELETE FROM calendar_events WHERE user_id = :userId;
     DELETE FROM calendar_insights WHERE user_id = :userId;
     DELETE FROM embeddings WHERE user_id = :userId AND source_type = 'calendar';
   
   IF provider = 'drive':
     DELETE FROM drive_documents WHERE user_id = :userId;
     DELETE FROM embeddings WHERE user_id = :userId AND source_type = 'drive';
   
   DELETE FROM briefings 
     WHERE user_id = :userId 
     AND briefing_date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::DATE;
   COMMIT;

6. Regenerate briefing with remaining sources:
   await generateBriefingForUser({ userId });

7. Return { success: true }
```

**CRITICAL SOURCE_TYPE MAPPING:**

| Provider | source_type for DELETE |
|----------|------------------------|
| `gmail` | `'email'` (NOT 'gmail'!) |
| `calendar` | `'calendar'` |
| `drive` | `'drive'` |

**CRITICAL: Briefing Date in UTC:**
```typescript
// Always delete today's briefing using UTC date
const todayUTC = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
await db
  .from('briefings')
  .delete()
  .eq('user_id', userId)
  .eq('briefing_date', todayUTC);
```

---

## 7. Inngest Sync Functions

### 7.1 Gmail Sync (`processGmailSync`)

```
EVENT: 'gmail/sync.requested'
DATA: { userId, connectionId, trigger, idempotencyKey, jobId }
CONFIG: { id: 'process-gmail-sync', retries: 3 }

STEP 1: IDEMPOTENCY CHECK
- Check if idempotencyKey already completed in sync_jobs
- If found with status='complete': RETURN existing result

STEP 2: FETCH SYNC JOB (ALREADY CREATED BY API)
- The API route creates the sync_job BEFORE sending the Inngest event
- Fetch sync_job by jobId from event data
- Verify job exists and status='pending'

STEP 3: UPDATE STATUS → 'fetching'

STEP 4: DETERMINE SYNC TYPE
- Get connection.last_sync_at
- IF last_sync_at IS NULL: Initial sync (7 days from daysAgoUTC(7))
- ELSE: Delta sync (since last_sync_at timestamp)

STEP 5: FETCH ALL MESSAGE IDS (PAGINATED)
```
```typescript
const query = `in:inbox after:${toUnixSeconds(afterDate)}`;
let allMessageIds: string[] = [];
let pageToken: string | null = null;

do {
  const response = await nango.proxy({
    endpoint: '/gmail/v1/users/me/messages',
    params: { q: query, maxResults: 500, pageToken }
  });
  
  allMessageIds = allMessageIds.concat(
    (response.data.messages || []).map((m: { id: string }) => m.id)
  );
  pageToken = response.data.nextPageToken;
} while (pageToken);
```
```
- NO LIMIT on total messages - fetch ALL matching IDs

STEP 6: FETCH FULL DETAILS (PARALLEL, CONCURRENCY=10)
```
```typescript
// Process in batches with concurrency limit
const messages = await Promise.all(
  allMessageIds.map(async (messageId) => {
    const response = await nango.proxy({
      endpoint: `/gmail/v1/users/me/messages/${messageId}`,
      params: { format: 'full' }
    });
    return response.data;
  })
);
```
```
- Parse headers: From, Subject, Date
- Extract: snippet, threadId, labelIds
- Decode HTML entities: &amp; → &, &lt; → <, etc.

STEP 7: UPDATE STATUS → 'securing'

STEP 8: DLP SCAN (NIGHTFALL)
- Batch size: 20 items per request
- Retry with exponential backoff on 429 (2s, 4s, 8s)
- Graceful failure: if DLP fails, continue without redaction
- Log warning but don't fail the sync
- **PII TOKENIZATION:**
  - Nightfall detects PII (names, emails, phone numbers, etc.)
  - For each finding: generate unique token like [PERSON_001]
  - Store in pii_vault: { user_id, token, original_value: encrypt(pii), detection_type }
  - Replace PII in content with token before persisting
  - NOTE: Re-hydration (replacing tokens back) is NOT automatic - tokens display as-is in UI

STEP 9: UPDATE STATUS → 'persisting'

STEP 10: COUNT BEFORE PERSIST
- SELECT COUNT(*) FROM emails WHERE user_id = :userId

STEP 11: PERSIST EMAILS
- Add user_id to each email record: { ...parsedEmail, user_id: userId }
- UPSERT with ON CONFLICT (user_id, message_id) DO UPDATE
- Convert received_at to ISO format: new Date(dateHeader).toISOString()

STEP 12: COUNT AFTER & CALCULATE dataChanged
- SELECT COUNT(*) FROM emails WHERE user_id = :userId
- itemsInserted = afterCount - beforeCount
- dataChanged = itemsInserted > 0

STEP 13: CONDITIONAL EMBEDDING GENERATION
- UPDATE sync_jobs SET status='embedding'
- IF OPENAI_API_KEY not configured: Skip with warning
- IF trigger='auto' AND dataChanged=false: Skip
- ELSE:
  - Fetch ALL emails for user (no arbitrary limit)
  - Filter out already-embedded (check content_hash)
  - Generate embeddings in batches of 100
  - UPSERT to embeddings table

STEP 14: UPDATE CONNECTION last_sync_at
- UPDATE connections SET last_sync_at = now() WHERE ...

STEP 15: MARK JOB COMPLETE
- UPDATE sync_jobs SET 
    status='complete', 
    items_fetched=<total fetched from API>,
    items_inserted=<itemsInserted from Step 12>,
    items_deleted=0,  -- Gmail doesn't track deletions
    completed_at=now()

ERROR HANDLING (applies to all steps):
- On any error, call classifyError(error) to determine action
- IF action='reconnect' (401/403 auth errors):
  - UPDATE connections SET status='error', metadata.error_reason='Token expired or revoked'
  - UPDATE sync_jobs SET status='error', error_message=..., error_retryable=false
  - DO NOT RETRY - requires user to reconnect
- IF action='backoff' (429 rate limit):
  - Inngest will auto-retry with configured backoff
- IF action='retry' (network/server errors):
  - Inngest will auto-retry up to 3 times
- IF action='fail' (other client errors):
  - UPDATE sync_jobs SET status='error', error_message=..., error_retryable=false
```

### 7.2 Calendar Sync (`processCalendarSync`)

Same structure as Gmail with these differences:

**STEP 4: DETERMINE SYNC TYPE**
```typescript
const syncToken = connection.metadata?.syncToken;

if (syncToken) {
  try {
    // Attempt delta sync with syncToken
    const response = await nango.proxy({
      endpoint: '/calendar/v3/calendars/primary/events',
      params: { syncToken }
    });
    // If 410 Gone, clear syncToken and retry as initial
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 410) {
      // syncToken expired, do initial sync
      await clearSyncToken(connectionId);
      // Fall through to initial sync
    }
  }
}

// Initial sync: 7 days back, 30 days forward
const timeMin = daysAgoUTC(7).toISOString();
const timeMax = daysFromNowUTC(30).toISOString();
```

**STEP 6: PARSE EVENTS**
```typescript
function parseEvent(event: GoogleCalendarEvent) {
  // All-day event: end.date is EXCLUSIVE (e.g., "2026-01-22" means event ends on 2026-01-21)
  const isAllDay = !event.end.dateTime;
  
  // For all-day events: start.date is INCLUSIVE (e.g., "2026-01-21" means midnight UTC)
  // PostgreSQL TIMESTAMPTZ will interpret "2026-01-21" as "2026-01-21T00:00:00Z"
  let startTime = event.start.dateTime || event.start.date;
  let endTime = event.end.dateTime || event.end.date;
  
  if (isAllDay) {
    // Normalize start_time to proper ISO format (midnight UTC)
    if (event.start.date && !event.start.date.includes('T')) {
      startTime = event.start.date + 'T00:00:00.000Z';
    }
    
    // Subtract 1 day from end_time to make it inclusive
    // CRITICAL: Use UTC methods to avoid timezone issues
    if (event.end.date) {
      const endDate = new Date(event.end.date);
      endDate.setUTCDate(endDate.getUTCDate() - 1);
      endTime = endDate.toISOString().split('T')[0] + 'T23:59:59.999Z';
    }
  }
  
  // Sanitize HTML in description
  const description = event.description 
    ? stripHtml(event.description) 
    : null;
  
  return {
    event_id: event.id,
    title: event.summary || '(No title)',
    description,
    start_time: startTime,
    end_time: endTime,
    is_all_day: isAllDay,
    location: event.location || null,
    attendees: event.attendees || [],
    organizer: event.organizer?.email || null,
    status: event.status // 'confirmed' | 'cancelled' | 'tentative'
  };
}
```

**STEP 11: PERSIST WITH DELETION**
```typescript
// Separate active and cancelled events
const activeEvents = events.filter(e => e.status !== 'cancelled');
const cancelledEventIds = events
  .filter(e => e.status === 'cancelled')
  .map(e => e.event_id);

// Delete cancelled events
if (cancelledEventIds.length > 0) {
  await db
    .from('calendar_events')
    .delete()
    .eq('user_id', userId)
    .in('event_id', cancelledEventIds);
  
  await db
    .from('embeddings')
    .delete()
    .eq('user_id', userId)
    .eq('source_type', 'calendar')
    .in('source_id', cancelledEventIds);
}

// Add user_id to each event (parseEvent doesn't include it)
const eventsWithUserId = activeEvents.map(e => ({ ...e, user_id: userId }));

// Detect conflicts using sweep line algorithm (O(n log n))
const eventsWithConflicts = detectConflicts(eventsWithUserId);

// UPSERT active events
await db
  .from('calendar_events')
  .upsert(eventsWithConflicts, { onConflict: 'user_id,event_id' });
```

**STEP 12.5: CALENDAR ANALYSIS**
```typescript
// UPDATE sync_jobs SET status='analyzing'
await db
  .from('sync_jobs')
  .update({ status: 'analyzing' })
  .eq('id', jobId);

const changeResult = await calculateCalendarDataChanged(
  userId, 
  lastSyncAt, 
  itemsInserted, 
  cancelledEventIds.length
);

// Skip analysis only if auto-sync AND no changes (data or time)
if (trigger === 'auto' && !changeResult.dataChanged && !changeResult.timeChanged) {
  console.log(`[Calendar] Skipping analysis: ${changeResult.reason}`);
} else {
  // Run analysis with Gemini
  const analysisResult = await runCalendarAnalysis(userId);
  
  // UPSERT into calendar_insights with full content + denormalized fields
  await db
    .from('calendar_insights')
    .upsert({
      user_id: userId,
      content: analysisResult.content,
      conflicts_count: analysisResult.conflicts_count,
      focus_time_hours: analysisResult.focus_time_hours,
      meeting_hours: analysisResult.meeting_hours,
      generated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
}
```

**STEP 14: UPDATE CONNECTION WITH SYNCTOKEN**
```typescript
await db
  .from('connections')
  .update({
    last_sync_at: new Date().toISOString(),
    metadata: {
      ...connection.metadata,
      syncToken: newSyncToken  // From calendar API response
    },
    updated_at: new Date().toISOString()
  })
  .eq('id', connectionId);
```

**STEP 15: MARK JOB COMPLETE (Calendar)**
```typescript
await db
  .from('sync_jobs')
  .update({
    status: 'complete',
    items_fetched: events.length,           // Total from API
    items_inserted: itemsInserted,           // From count comparison
    items_deleted: cancelledEventIds.length, // Cancelled events
    time_changed: changeResult.timeChanged,  // For client briefing decision
    completed_at: new Date().toISOString()
  })
  .eq('id', jobId);
```

### 7.3 Drive Sync (`processDriveSync`)

```
EVENT: 'drive/sync.requested'
DATA: { userId, connectionId, trigger, idempotencyKey, jobId }
CONFIG: { id: 'process-drive-sync', retries: 3 }

STEP 1-4: Same as Gmail (idempotency, fetch job, update status, determine sync type)

STEP 5: FETCH DRIVE FILES
```
```typescript
const since = lastSyncAt 
  ? lastSyncAt.toISOString()
  : daysAgoUTC(14).toISOString();

const query = `modifiedTime > '${since}' and trashed = false`;

// Paginate through all files
let allFiles = [];
let pageToken = null;

do {
  const response = await nango.proxy({
    endpoint: '/drive/v3/files',
    params: {
      q: query,
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,md5Checksum,parents)',
      pageSize: 1000,
      pageToken
    }
  });
  
  allFiles = allFiles.concat(response.data.files || []);
  pageToken = response.data.nextPageToken;
} while (pageToken);
```

```
STEP 6: PARSE FILE METADATA
- Extract: id, name, mimeType, modifiedTime, webViewLink, md5Checksum
- Build folder path from parents[] if available
- For text files (docs, sheets, etc.): fetch content preview via export
  - Skip binary files (images, videos, PDFs) for content preview

STEP 7: UPDATE STATUS → 'securing'

STEP 8: DLP SCAN (NIGHTFALL)
- Same as Gmail: batch size 20, exponential backoff
- Scan file names and content previews

STEP 9: UPDATE STATUS → 'persisting'

STEP 10: COUNT BEFORE PERSIST
- SELECT COUNT(*) FROM drive_documents WHERE user_id = :userId

STEP 11: PERSIST DOCUMENTS
- Add user_id to each record: { ...parsedFile, user_id: userId }
- UPSERT with ON CONFLICT (user_id, document_id) DO UPDATE
- Map fields: 
  - document_id = file.id (Google Drive ID)
  - name = file.name
  - mime_type = file.mimeType
  - modified_at = file.modifiedTime
  - web_view_link = file.webViewLink
  - md5_checksum = file.md5Checksum

STEP 12: COUNT AFTER & CALCULATE dataChanged
- SELECT COUNT(*) FROM drive_documents WHERE user_id = :userId
- itemsInserted = afterCount - beforeCount
- dataChanged = itemsInserted > 0

STEP 13: CONDITIONAL EMBEDDING GENERATION
- UPDATE sync_jobs SET status='embedding'
- IF OPENAI_API_KEY not configured: Skip
- IF trigger='auto' AND dataChanged=false: Skip
- ELSE: Generate embeddings for all documents (use prepareDriveEmbeddings)

STEP 14: UPDATE CONNECTION last_sync_at

STEP 15: MARK JOB COMPLETE
```

**NOTE:** Drive does NOT have time-based change detection like Calendar. Only `dataChanged` is relevant.

---

## 8. API Routes

**Required API Routes (from Architecture Overview):**

| Route | Method | Description | Defined In |
|-------|--------|-------------|------------|
| `/api/connections` | GET | List all connections for user | Section 8.2 |
| `/api/integrations/{provider}/sync` | POST | Trigger sync, poll for result | Section 8.1 |
| `/api/integrations/{provider}/disconnect` | POST | Remove connection + data | Section 6 |
| `/api/ai/briefing/generate` | POST | Generate briefing on-demand | Section 16.6 |
| `/api/ai/briefing/[date]` | GET | Fetch briefing for date | *Implementation detail* |
| `/api/ai/chat` | POST | RAG chat with streaming | *Implementation detail* |
| `/api/calendar/imminent` | GET | Check for imminent events | *Implementation detail* |
| `/api/nango/webhook` | POST | Receive Nango connection events | Section 5 |

> **NOTE:** Routes marked "*Implementation detail*" follow standard patterns:
> - `GET /api/ai/briefing/[date]`: Query `briefings` table by user_id and date
> - `POST /api/ai/chat`: Use `buildChatSystemPrompt()` (Section 9.5), call `callGeminiChat()` (NOT `callGeminiJSON`), stream response via SSE
> - `GET /api/calendar/imminent?threshold=30`: Query next event starting within threshold minutes (see Section 11.2)

### 8.1 POST /api/integrations/{provider}/sync

```typescript
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  // 1. Extract provider from route params
  const { provider } = await params;
  
  // 2. Auth
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 3. Parse trigger
  const body = await request.json().catch(() => ({}));
  const trigger = body.trigger || 'manual';
  
  // 4. Check connection exists
  const { data: connection } = await supabase
    .from('connections')
    .select('id, connection_id, last_sync_at, metadata')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('status', 'connected')
    .single();
    
  if (!connection) {
    return NextResponse.json({
      success: true,
      warning: 'Not connected',
      dataChanged: false,
      itemsSynced: 0
    });
  }

  // 5. Create sync job and send Inngest event
  const jobId = crypto.randomUUID();
  const idempotencyKey = `${trigger}-${userId}-${provider}-${Date.now()}`;
  
  await supabase
    .from('sync_jobs')
    .insert({
      id: jobId,
      user_id: userId,
      provider,
      trigger,
      idempotency_key: idempotencyKey,
      status: 'pending'
    });
  
  await inngest.send({
    name: `${provider}/sync.requested`,
    data: {
      userId,
      connectionId: connection.id,
      trigger,
      idempotencyKey,
      jobId
    }
  });

  // 6. Poll for completion (max 120s)
  const TIMEOUT = 120000;
  const POLL_INTERVAL = 500;
  const startTime = Date.now();
  
  while (Date.now() - startTime < TIMEOUT) {
    const { data: job } = await supabase
      .from('sync_jobs')
      .select('status, items_inserted, items_updated, items_deleted, time_changed, error_message')
      .eq('id', jobId)
      .single();
    
    if (job?.status === 'complete') {
      const itemsSynced = (job.items_inserted || 0) + (job.items_updated || 0);
      const dataChanged = itemsSynced > 0 || (job.items_deleted || 0) > 0;
      
      return NextResponse.json({
        success: true,
        itemsSynced,
        itemsDeleted: job.items_deleted || 0,
        syncType: connection.last_sync_at ? 'delta' : 'initial',
        dataChanged,
        timeChanged: job.time_changed || false  // Calendar only
      });
    }
    
    if (job?.status === 'error') {
      return NextResponse.json(
        { success: false, error: job.error_message },
        { status: 500 }
      );
    }
    
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
  
  // 7. Timeout - still processing
  return NextResponse.json({
    success: true,
    queued: true,
    dataChanged: false,
    warning: 'Sync is still processing in the background.'
  });
}
```

### 8.2 GET /api/connections

```typescript
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const { data: connections } = await supabase
    .from('connections')
    .select('provider, status, last_sync_at, metadata')
    .eq('user_id', userId);
  
  // Initialize all providers as disconnected
  const result: Record<string, ConnectionStatus> = {
    gmail: { status: 'disconnected', lastSyncAt: null, error: null },
    calendar: { status: 'disconnected', lastSyncAt: null, error: null },
    drive: { status: 'disconnected', lastSyncAt: null, error: null }
  };
  
  // Override with actual connection data
  for (const conn of connections || []) {
    result[conn.provider] = {
      status: conn.status,
      lastSyncAt: conn.last_sync_at || null,
      error: conn.metadata?.error_reason || null
    };
  }
  
  return NextResponse.json({ connections: result });
}
```

---

## 9. LLM Prompts

### 9.1 Prompt Design Principles

**CRITICAL FOR CONSISTENCY:**

1. **Deterministic Temperature**: Use `temperature: 0` for all analysis prompts
2. **Structured Output**: Always request JSON format with explicit schema
3. **Explicit Instructions**: No ambiguity in what the model should produce
4. **Current Time Context**: Always include exact current time in UTC
5. **Quantitative Metrics**: Request specific numbers, not vague assessments

### 9.2 Date Helper Functions (Required for Prompts)

```typescript
/**
 * Check if a date string represents today (UTC)
 */
function isToday(dateString: string): boolean {
  const date = new Date(dateString);
  const now = new Date();
  return (
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate()
  );
}

/**
 * Check if a date string is within this week (UTC)
 * Week starts on Sunday
 */
function isThisWeek(dateString: string): boolean {
  const date = new Date(dateString);
  const now = new Date();
  
  // Get start of this week (Sunday 00:00:00 UTC)
  const weekStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - now.getUTCDay(),
    0, 0, 0, 0
  ));
  
  // Get end of this week (Saturday 23:59:59 UTC)
  const weekEnd = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - now.getUTCDay() + 6,
    23, 59, 59, 999
  ));
  
  return date >= weekStart && date <= weekEnd;
}
```

### 9.3 Calendar Analysis Prompt

```typescript
function buildCalendarAnalysisPrompt(
  events: CalendarEvent[],
  conflicts: ConflictInfo[],
  focusBlocks: FocusBlock[]
): string {
  const now = new Date();
  const currentTimeUTC = now.toISOString();
  const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getUTCDay()];
  
  const todayEvents = events.filter(e => isToday(e.start_time));
  const thisWeekEvents = events.filter(e => isThisWeek(e.start_time));
  
  const totalMeetingMinutes = events.reduce((sum, e) => {
    return sum + (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000;
  }, 0);
  
  const backToBackSequences = identifyBackToBackMeetings(events);
  
  return `You are an executive time strategist analyzing a calendar for optimal productivity.

## CURRENT CONTEXT
- Current Time (UTC): ${currentTimeUTC}
- Day of Week: ${dayOfWeek}
- Today's Meetings: ${todayEvents.length}
- This Week's Meetings: ${thisWeekEvents.length}
- Total Meeting Hours This Week: ${(totalMeetingMinutes / 60).toFixed(1)}
- Conflicts Detected: ${conflicts.length}
- Back-to-Back Sequences (3+ meetings): ${backToBackSequences.length}
- Available Focus Blocks (2+ hours): ${focusBlocks.length}

## STRATEGIC FRAMEWORKS TO APPLY

### Time-Boxing Method
- Every minute should be accounted for
- Batch similar tasks together
- Protect high-value time blocks ruthlessly

### Priority Matrix (Urgent/Important)
- Quadrant 1: Urgent & Important → Do immediately
- Quadrant 2: Important, Not Urgent → Schedule protected time
- Quadrant 3: Urgent, Not Important → Delegate if possible
- Quadrant 4: Neither → Eliminate or minimize

### Executive Effectiveness Principle
- 70%+ of time should align with top 3 priorities
- Meetings without clear outcomes should be questioned
- Buffer time between meetings prevents context-switching costs

## CALENDAR DATA
${JSON.stringify(events.map(e => ({
  title: e.title,
  start: e.start_time,
  end: e.end_time,
  duration_minutes: (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000,
  attendees_count: e.attendees?.length || 0,
  has_conflict: e.has_conflict,
  location: e.location
})), null, 2)}

## CONFLICTS DETECTED
${JSON.stringify(conflicts, null, 2)}

## AVAILABLE FOCUS BLOCKS
${JSON.stringify(focusBlocks, null, 2)}

## YOUR TASK
Analyze this calendar and provide strategic recommendations. Be direct, specific, and actionable.

Respond with ONLY valid JSON in this exact format:
{
  "executiveSummary": "One paragraph overview of calendar health and key concerns",
  "urgentActions": [
    {
      "priority": 1,
      "action": "Specific action to take",
      "reason": "Why this matters",
      "timeframe": "When to do it"
    }
  ],
  "conflictResolutions": [
    {
      "conflictingEvents": ["Event A", "Event B"],
      "recommendation": "How to resolve",
      "suggestedAction": "RESCHEDULE|DELEGATE|DECLINE|SHORTEN"
    }
  ],
  "delegationOpportunities": [
    {
      "meeting": "Meeting title",
      "reason": "Why delegate",
      "suggestedDelegate": "Role or criteria"
    }
  ],
  "focusTimeProtection": {
    "availableHours": 0.0,
    "recommendation": "How to protect focus time",
    "suggestedBlocks": ["Time ranges to protect"]
  },
  "weeklyInsights": {
    "meetingLoad": "LIGHT|MODERATE|HEAVY|OVERLOADED",
    "balanceScore": 0,
    "topConcern": "Main issue to address"
  },
  "metrics": {
    "meetingHoursTotal": 0.0,
    "focusHoursAvailable": 0.0,
    "conflictCount": 0,
    "backToBackCount": 0
  }
}`;
}
```

### 9.4 Daily Briefing Prompt

```typescript
function buildBriefingPrompt(
  emails: Email[],
  events: CalendarEvent[],
  documents: DriveDocument[],
  connectedSources: { gmail: boolean; calendar: boolean; drive: boolean }
): string {
  const now = new Date();
  const currentTimeUTC = now.toISOString();
  const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getUTCDay()];
  const hour = now.getUTCHours();
  
  // Time-of-day context
  let timeContext: string;
  if (hour < 6) timeContext = 'Early Morning - Pre-dawn preparation time';
  else if (hour < 12) timeContext = 'Morning - Peak focus and decision-making period';
  else if (hour < 14) timeContext = 'Midday - Energy dip, lighter tasks recommended';
  else if (hour < 17) timeContext = 'Afternoon - Second wind for complex work';
  else timeContext = 'Evening - Wrap-up and next-day preparation';
  
  // Day context
  let dayContext: string;
  if (dayOfWeek === 'Monday') dayContext = 'Week start - Set priorities and align team';
  else if (dayOfWeek === 'Friday') dayContext = 'Week end - Close loops and prepare handoffs';
  else if (dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday') dayContext = 'Weekend - Strategic thinking and recovery';
  else dayContext = 'Mid-week - Execution and progress focus';
  
  // Find next event
  const upcomingEvents = events
    .filter(e => new Date(e.start_time) > now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const nextEvent = upcomingEvents[0];
  const minutesToNextEvent = nextEvent 
    ? Math.round((new Date(nextEvent.start_time).getTime() - now.getTime()) / 60000)
    : null;
  
  // Identify VIP/urgent emails
  const urgentKeywords = ['urgent', 'asap', 'immediately', 'critical', 'deadline', 'eod', 'cob'];
  const urgentEmails = emails.filter(e => 
    urgentKeywords.some(kw => 
      e.subject.toLowerCase().includes(kw) || 
      (e.snippet || '').toLowerCase().includes(kw)
    )
  );

  return `You are a chief of staff preparing an executive briefing.

## CURRENT CONTEXT
- Current Time (UTC): ${currentTimeUTC}
- Day: ${dayOfWeek}
- Time Context: ${timeContext}
- Day Context: ${dayContext}
${nextEvent ? `- Next Event: "${nextEvent.title}" in ${minutesToNextEvent} minutes` : '- No upcoming events today'}

## DATA SOURCES STATUS
- Gmail: ${connectedSources.gmail ? `Connected (${emails.length} recent emails, ${urgentEmails.length} potentially urgent)` : 'Not connected'}
- Calendar: ${connectedSources.calendar ? `Connected (${events.length} events in scope)` : 'Not connected'}
- Drive: ${connectedSources.drive ? `Connected (${documents.length} recent documents)` : 'Not connected'}

## EMAILS (Last 24 hours)
${connectedSources.gmail ? JSON.stringify(emails.map(e => ({
  from: e.sender,
  subject: e.subject,
  snippet: e.snippet?.substring(0, 100),
  received: e.received_at,
  is_potentially_urgent: urgentEmails.includes(e)
})), null, 2) : 'Gmail not connected'}

## TODAY'S SCHEDULE
${connectedSources.calendar ? JSON.stringify(events.filter(e => isToday(e.start_time)).map(e => ({
  title: e.title,
  start: e.start_time,
  end: e.end_time,
  location: e.location,
  attendees_count: e.attendees?.length || 0,
  has_conflict: e.has_conflict
})), null, 2) : 'Calendar not connected'}

## RECENT DOCUMENTS
${connectedSources.drive ? JSON.stringify(documents.slice(0, 10).map(d => ({
  name: d.name,
  type: d.mime_type,
  modified: d.modified_at
})), null, 2) : 'Drive not connected'}

## YOUR TASK
Create a concise, actionable briefing. Focus on what matters most RIGHT NOW.

Respond with ONLY valid JSON in this exact format:
{
  "executiveSummary": "2-3 sentence overview of what demands attention today",
  "topPriority": {
    "item": "The single most important thing",
    "reason": "Why this is #1",
    "suggestedAction": "Specific next step"
  },
  "urgentAttention": [
    {
      "type": "EMAIL|MEETING|DOCUMENT|CONFLICT",
      "item": "Description",
      "action": "What to do",
      "deadline": "When (if applicable)"
    }
  ],
  "scheduleInsight": {
    "meetingCount": 0,
    "totalMeetingHours": 0.0,
    "nextMeeting": "Title or null",
    "minutesUntilNext": 0,
    "conflicts": [],
    "freeBlocks": ["Time ranges"]
  },
  "actionItems": [
    {
      "task": "Specific task",
      "source": "EMAIL|CALENDAR|DRIVE|ANALYSIS",
      "priority": "HIGH|MEDIUM|LOW",
      "canDelegate": true,
      "delegateTo": "Role suggestion or null"
    }
  ],
  "intelligence": {
    "emailHighlights": ["Key email summaries"],
    "documentActivity": ["Notable document changes"],
    "patterns": ["Any patterns noticed"]
  },
  "closingNote": "One sentence of strategic advice for the day"
}`;
}
```

### 9.5 Chat System Prompt

```typescript
function buildChatSystemPrompt(
  connectedSources: { gmail: boolean; calendar: boolean; drive: boolean },
  searchContext: SearchResult[]
): string {
  const now = new Date();
  const currentTimeUTC = now.toISOString();
  
  const connectedList = Object.entries(connectedSources)
    .filter(([, connected]) => connected)
    .map(([source]) => source);
  
  const disconnectedList = Object.entries(connectedSources)
    .filter(([, connected]) => !connected)
    .map(([source]) => source);

  return `You are a strategic executive assistant with access to the user's connected data sources.

## CURRENT CONTEXT
- Current Time (UTC): ${currentTimeUTC}
- Connected Sources: ${connectedList.length > 0 ? connectedList.join(', ') : 'None'}
${disconnectedList.length > 0 ? `- Not Connected: ${disconnectedList.join(', ')} (user can connect these in Settings)` : ''}

## COMMUNICATION STYLE
- Be direct and concise - executives value brevity
- Lead with the answer, then provide supporting details
- If something is time-sensitive, say so explicitly
- When uncertain, say "Based on available data..." rather than guessing

## RELEVANT CONTEXT FROM SEARCH
${searchContext.length > 0 ? JSON.stringify(searchContext.map(r => ({
  type: r.sourceType,
  content: r.content,
  metadata: r.metadata
})), null, 2) : 'No specific context found for this query.'}

## GUIDELINES
1. USE the search context above to answer questions with specific data
2. If data contains security tokens like [PERSON_001], display them as-is
3. Only mention disconnected sources if the user specifically asks about them
4. Cite sources when referencing specific emails, events, or documents
5. For time-related questions, consider the current UTC time

Provide helpful, accurate responses based on the user's connected data.`;
}
```

### 9.6 LLM Call Configuration

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini client (requires GEMINI_API_KEY env var)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// Config for ANALYSIS/BRIEFING (requires structured JSON output)
const GEMINI_JSON_CONFIG = {
  generationConfig: {
    temperature: 0,           // Deterministic output
    topP: 1,
    topK: 1,
    maxOutputTokens: 4096,
    responseMimeType: 'application/json'  // Enforce JSON output
  }
};

// Config for CHAT (natural language, streaming)
const GEMINI_CHAT_CONFIG = {
  generationConfig: {
    temperature: 0.7,         // Slightly creative for conversation
    topP: 0.9,
    maxOutputTokens: 2048
    // NO responseMimeType - plain text response
  }
};

/**
 * Call Gemini for structured JSON responses (briefing, analysis)
 */
async function callGeminiJSON(prompt: string, maxRetries = 3): Promise<string> {
  const delays = [2000, 4000, 8000];  // Exponential backoff
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...GEMINI_JSON_CONFIG
      });
      
      return result.response.text();
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      if (status === 429 && attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, delays[attempt]));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * Call Gemini for chat (natural language, supports streaming via SSE)
 * Returns a ReadableStream for Server-Sent Events response
 */
async function callGeminiChat(
  systemPrompt: string, 
  userMessage: string
): Promise<ReadableStream<Uint8Array>> {
  const result = await model.generateContentStream({
    contents: [
      { role: 'user', parts: [{ text: systemPrompt + '\n\nUser: ' + userMessage }] }
    ],
    ...GEMINI_CHAT_CONFIG
  });
  
  // Convert Gemini stream to SSE-compatible ReadableStream
  const encoder = new TextEncoder();
  
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            // SSE format: data: {text}\n\n
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });
}
```

> **⚠️ CRITICAL:** Use `callGeminiJSON` for briefings and calendar analysis. Use `callGeminiChat` for conversational chat responses.

---

## 10. Inngest Cron Jobs

### 10.1 Function List

| Function ID | Trigger | Purpose |
|-------------|---------|---------|
| `process-gmail-sync` | `gmail/sync.requested` | Full Gmail sync pipeline |
| `process-calendar-sync` | `calendar/sync.requested` | Full Calendar sync + inline analysis |
| `process-drive-sync` | `drive/sync.requested` | Full Drive sync pipeline |
| `generate-daily-briefing-cron` | CRON `0 6 * * *` | 6 AM UTC morning briefing for all users |
| `cleanup-old-data-cron` | CRON `0 3 * * *` | 3 AM UTC data retention cleanup |

> **NOTE:** On-demand briefing (`POST /api/ai/briefing/generate`) calls `generateBriefingForUser()` directly without Inngest. This is intentional for faster response times.

**EXPLICITLY NOT NEEDED:**
- ❌ Calendar analysis cron (done inline during sync)
- ❌ Embedding generation cron (done inline during sync)
- ❌ On-demand briefing via Inngest (direct API call is faster)

### 10.2 Morning Briefing Cron

```typescript
export const generateDailyBriefingCron = inngest.createFunction(
  { id: 'generate-daily-briefing-cron', name: 'Daily Morning Briefing' },
  { cron: '0 6 * * *' },  // 6 AM UTC
  async ({ step }) => {
    // Get all users with at least one connected source
    const users = await step.run('get-active-users', async () => {
      const { data } = await supabase
        .from('connections')
        .select('user_id')
        .eq('status', 'connected');
      
      // Deduplicate user IDs
      const uniqueUserIds = [...new Set(data?.map(c => c.user_id) || [])];
      return uniqueUserIds;
    });
    
    // Generate briefing for each user
    const results = [];
    for (const userId of users) {
      const result = await step.run(`briefing-${userId}`, async () => {
        try {
          return await generateBriefingForUser({ userId });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Briefing failed for ${userId}:`, error);
          return { userId, success: false, error: errorMessage };
        }
      });
      results.push(result);
    }
    
    return {
      usersProcessed: users.length,
      results
    };
  }
);
```

### 10.3 Cleanup Cron

```typescript
export const cleanupOldDataCron = inngest.createFunction(
  { id: 'cleanup-old-data-cron', name: 'Data Retention Cleanup' },
  { cron: '0 3 * * *' },  // 3 AM UTC
  async ({ step }) => {
    const RETENTION_DAYS = 30;
    const SYNC_JOB_RETENTION_DAYS = 7;
    
    const cutoffDate = daysAgoUTC(RETENTION_DAYS).toISOString();
    const syncJobCutoff = daysAgoUTC(SYNC_JOB_RETENTION_DAYS).toISOString();
    
    // Step 1: Delete old emails
    const emailsDeleted = await step.run('cleanup-emails', async () => {
      const { count } = await supabase
        .from('emails')
        .delete({ count: 'exact' })  // count option goes in delete()
        .lt('received_at', cutoffDate);
      return count || 0;
    });
    
    // Step 2: Delete old calendar events
    const eventsDeleted = await step.run('cleanup-calendar-events', async () => {
      const { count } = await supabase
        .from('calendar_events')
        .delete({ count: 'exact' })
        .lt('end_time', cutoffDate);
      return count || 0;
    });
    
    // Step 3: Delete old drive documents
    const docsDeleted = await step.run('cleanup-drive-documents', async () => {
      const { count } = await supabase
        .from('drive_documents')
        .delete({ count: 'exact' })
        .lt('modified_at', cutoffDate);
      return count || 0;
    });
    
    // Step 4: Delete old briefings (keep last 30 days)
    const briefingsDeleted = await step.run('cleanup-briefings', async () => {
      const cutoffDateOnly = cutoffDate.split('T')[0];
      const { count } = await supabase
        .from('briefings')
        .delete({ count: 'exact' })  // count option goes in delete()
        .lt('briefing_date', cutoffDateOnly);
      return count || 0;
    });
    
    // Step 5: Delete old sync jobs (completed or stuck)
    const syncJobsDeleted = await step.run('cleanup-sync-jobs', async () => {
      // Delete completed jobs older than 7 days
      const { count: completedCount } = await supabase
        .from('sync_jobs')
        .delete({ count: 'exact' })
        .lt('completed_at', syncJobCutoff);
      
      // Delete stuck jobs (never completed, started > 24 hours ago)
      const stuckCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: stuckCount } = await supabase
        .from('sync_jobs')
        .delete({ count: 'exact' })
        .is('completed_at', null)
        .lt('started_at', stuckCutoff);
      
      return (completedCount || 0) + (stuckCount || 0);
    });
    
    // Step 6: Delete orphaned embeddings
    const orphanedDeleted = await step.run('cleanup-orphaned-embeddings', async () => {
      // This requires a more complex query - embeddings without source records
      // Execute as raw SQL for efficiency
      const { data } = await supabase.rpc('delete_orphaned_embeddings');
      return data || 0;
    });
    
    return {
      emailsDeleted,
      eventsDeleted,
      docsDeleted,
      briefingsDeleted,
      syncJobsDeleted,
      orphanedDeleted
    };
  }
);
```

**SQL Function for Orphaned Embeddings:**

> **CRITICAL:** `source_id` stores EXTERNAL IDs (message_id, event_id, document_id), NOT database UUIDs!

```sql
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
```

---

## 11. Client: SyncManager Specification

### 11.1 State Structure

```typescript
interface SyncManagerState {
  providers: {
    gmail: ProviderState;
    calendar: ProviderState;
    drive: ProviderState;
  };
  queue: SyncRequest[];
  isProcessing: boolean;
  lastGlobalSync: string | null;
  lastSyncDateUTC: string | null;         // 'YYYY-MM-DD' for date boundary detection
  notifiedEventIds: Set<string>;          // For imminent event tracking
}

interface ProviderState {
  status: 'connected' | 'disconnected' | 'error';
  lastSyncAt: string | null;              // ISO timestamp
  isSyncing: boolean;
  error?: string;
}

interface SyncRequest {
  id: string;
  providers: ProviderKey[];
  trigger: 'manual' | 'auto' | 'date_boundary';
  timestamp: number;
}

// ProviderKey type defined in Section 13 (Provider Config Key Mapping)
// type ProviderKey = 'gmail' | 'calendar' | 'drive';
```

### 11.2 Auto-Sync Implementation

```typescript
// userId comes from Clerk auth context (useUser().user?.id)
// lastSyncDateUTC and notifiedEventIds are managed via useRef

function setupAutoSync(userId: string) {
  // Calculate ms until next 10-minute mark
  const calculateNextTick = (): number => {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const ms = now.getMilliseconds();
    
    const nextInterval = Math.ceil((minutes + 1) / 10) * 10;
    const minutesToNext = nextInterval - minutes;
    const msUntilNext = (minutesToNext * 60 - seconds) * 1000 - ms;
    
    return msUntilNext > 0 ? msUntilNext : 600000; // 10 min fallback
  };
  
  const tick = async () => {
    const now = new Date();
    const todayUTC = now.toISOString().split('T')[0];
    
    // 1. Check date boundary (midnight UTC crossing)
    if (lastSyncDateUTC && todayUTC !== lastSyncDateUTC) {
      console.log('[SyncManager] Date boundary crossed, triggering full re-analysis');
      await enqueueSync(['gmail', 'calendar', 'drive'], 'date_boundary');
      lastSyncDateUTC = todayUTC;
      setTimeout(tick, calculateNextTick());
      return;
    }
    
    // 2. Check imminent events (30 minutes threshold)
    const imminentEvent = await checkImminentEvents(30);
    if (imminentEvent && !notifiedEventIds.has(imminentEvent.event_id)) {
      notifiedEventIds.add(imminentEvent.event_id);
      await triggerImminentEventNotification(imminentEvent);
    }
    
    // 3. Standard auto-sync
    await enqueueSync(['gmail', 'calendar', 'drive'], 'auto');
    lastSyncDateUTC = todayUTC;
    
    setTimeout(tick, calculateNextTick());
  };
  
  // Start on next 10-minute boundary
  setTimeout(tick, calculateNextTick());
}

async function checkImminentEvents(
  thresholdMinutes: number
): Promise<CalendarEvent | null> {
  // Must use API route - client cannot access Supabase directly (Clerk auth)
  const response = await fetch(
    `/api/calendar/imminent?threshold=${thresholdMinutes}`
  );
  
  if (!response.ok) {
    console.error('[SyncManager] Failed to check imminent events');
    return null;
  }
  
  const { event } = await response.json();
  return event || null;
}

// API Route Implementation: GET /api/calendar/imminent
// (Add to Section 8 API Routes table)
// Query: SELECT * FROM calendar_events 
//        WHERE user_id = :userId 
//        AND start_time > now() 
//        AND start_time <= now() + :threshold minutes
//        ORDER BY start_time LIMIT 1

function triggerImminentEventNotification(event: CalendarEvent): void {
  // Display a toast or browser notification for imminent event
  const minutesUntil = Math.round(
    (new Date(event.start_time).getTime() - Date.now()) / 60000
  );
  
  // Dispatch custom event for UI to handle
  window.dispatchEvent(
    new CustomEvent('eos:imminent-event', {
      detail: {
        eventId: event.event_id,
        title: event.title,
        startTime: event.start_time,
        minutesUntil,
        location: event.location
      }
    })
  );
  
  // Optionally use browser Notification API if permission granted
  if (Notification.permission === 'granted') {
    new Notification(`Upcoming: ${event.title}`, {
      body: `Starts in ${minutesUntil} minutes${event.location ? ` at ${event.location}` : ''}`,
      icon: '/favicon.ico',
      tag: event.event_id  // Prevents duplicate notifications
    });
  }
}
```

### 11.3 Queue Deduplication

```typescript
const MAX_QUEUE_LENGTH = 3;
const DEDUP_WINDOW_MS = 2000;

async function enqueueSync(
  providers: ProviderKey[], 
  trigger: 'manual' | 'auto' | 'date_boundary'
): Promise<void> {
  // 1. Filter to only CONNECTED providers
  const connected = providers.filter(
    p => state.providers[p].status === 'connected'
  );
  
  if (connected.length === 0) {
    if (trigger === 'manual') {
      toast.warning('No connected sources to sync');
    }
    return;
  }
  
  // 2. Check queue limit
  if (queue.length >= MAX_QUEUE_LENGTH) {
    if (trigger === 'manual') {
      toast.warning('Please wait, sync already in progress');
    }
    return;
  }
  
  // 3. Deduplicate (same providers within 2 seconds)
  const sortedProviders = [...connected].sort();
  const isDuplicate = queue.some(req => {
    const reqProviders = [...req.providers].sort();
    return (
      arraysEqual(reqProviders, sortedProviders) &&
      Date.now() - req.timestamp < DEDUP_WINDOW_MS
    );
  });
  
  if (isDuplicate) {
    console.log('[SyncManager] Duplicate request ignored');
    return;
  }
  
  // 4. Add to queue and process
  queue.push({
    id: crypto.randomUUID(),
    providers: connected,
    trigger,
    timestamp: Date.now()
  });
  
  processQueue();
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function processQueue(): Promise<void> {
  if (isProcessing || queue.length === 0) {
    return;
  }
  
  isProcessing = true;
  const request = queue.shift()!;
  
  try {
    // Dispatch start event
    dispatchConnectionsUpdated({
      providers: request.providers,
      trigger: request.trigger,
      dataChanged: false,
      briefingRegenerated: false,
      phase: 'start'
    });
    
    // Set syncing state for each provider
    for (const provider of request.providers) {
      state.providers[provider].isSyncing = true;
    }
    
    // Sync each provider (parallel)
    let anyDataChanged = false;
    const results = await Promise.all(
      request.providers.map(async (provider) => {
        const response = await fetch(`/api/integrations/${provider}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger: request.trigger })
        });
        const data = await response.json();
        
        // Check for API-level errors
        if (!response.ok || data.error) {
          console.error(`[SyncManager] Sync failed for ${provider}:`, data.error);
          return { provider, dataChanged: false, timeChanged: false, error: data.error };
        }
        
        return { provider, ...data };
      })
    );
    
    // Update state and check for data/time changes
    let anyTimeChanged = false;
    for (const result of results) {
      state.providers[result.provider].isSyncing = false;
      if (result.dataChanged) {
        anyDataChanged = true;
      }
      if (result.timeChanged) {
        anyTimeChanged = true;
      }
    }
    
    // Refresh connection state to get updated lastSyncAt
    const connectionsResponse = await fetch('/api/connections');
    const { connections } = await connectionsResponse.json();
    for (const [provider, connStatus] of Object.entries(connections)) {
      const status = connStatus as ConnectionStatus;
      state.providers[provider as ProviderKey].lastSyncAt = status.lastSyncAt;
      state.providers[provider as ProviderKey].status = status.status;
    }
    
    // Regenerate briefing based on trigger and data/time changes
    let briefingRegenerated = false;
    const shouldRegenerate = 
      request.trigger === 'manual' ||
      request.trigger === 'date_boundary' ||
      anyDataChanged ||
      anyTimeChanged;  // Calendar time-based changes warrant briefing update
    
    if (shouldRegenerate) {
      await fetch('/api/ai/briefing/generate', { method: 'POST' });
      briefingRegenerated = true;
    }
    
    // Dispatch complete event
    dispatchConnectionsUpdated({
      providers: request.providers,
      trigger: request.trigger,
      dataChanged: anyDataChanged,
      briefingRegenerated,
      phase: 'complete'
    });
    
  } catch (error) {
    // Reset syncing state on error
    for (const provider of request.providers) {
      state.providers[provider].isSyncing = false;
    }
    
    dispatchConnectionsUpdated({
      providers: request.providers,
      trigger: request.trigger,
      dataChanged: false,
      briefingRegenerated: false,
      phase: 'error',
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    isProcessing = false;
    
    // Process next item in queue if any
    if (queue.length > 0) {
      processQueue();
    }
  }
}
```

### 11.4 Event Dispatch

```typescript
interface ConnectionsUpdatedDetail {
  providers: ProviderKey[];
  trigger: 'connect' | 'disconnect' | 'manual' | 'auto' | 'date_boundary';
  dataChanged: boolean;
  briefingRegenerated: boolean;
  phase: 'start' | 'complete' | 'error';
  error?: string;
}

function dispatchConnectionsUpdated(detail: ConnectionsUpdatedDetail): void {
  window.dispatchEvent(
    new CustomEvent('eos:connections-updated', { detail })
  );
}

// Usage in processQueue:
dispatchConnectionsUpdated({
  providers: ['gmail', 'calendar'],
  trigger: 'manual',
  dataChanged: true,
  briefingRegenerated: true,
  phase: 'complete'
});
```

---

## 12. OAuth Scopes Required

```
Google Mail:
  - https://www.googleapis.com/auth/gmail.readonly

Google Calendar:
  - https://www.googleapis.com/auth/calendar.readonly

Google Drive:
  - https://www.googleapis.com/auth/drive.readonly
  - https://www.googleapis.com/auth/drive.metadata.readonly
```

---

## 13. Provider Config Key Mapping

```typescript
const PROVIDER_CONFIG_KEYS = {
  gmail: 'google-mail',
  calendar: 'google-calendar',
  drive: 'google-drive'
} as const;

const PROVIDER_FROM_CONFIG_KEY = {
  'google-mail': 'gmail',
  'google-calendar': 'calendar',
  'google-drive': 'drive'
} as const;

type ProviderKey = keyof typeof PROVIDER_CONFIG_KEYS;
type ConfigKey = keyof typeof PROVIDER_FROM_CONFIG_KEY;
```

---

## 14. Error Classification

```typescript
interface ClassifiedError {
  retryable: boolean;
  category: 'auth' | 'rate_limit' | 'network' | 'server' | 'client' | 'unknown';
  action: 'retry' | 'reconnect' | 'fail' | 'backoff';
}

function classifyError(error: unknown): ClassifiedError {
  const errorObj = error as { status?: number; code?: string | number };
  const status = errorObj.status || errorObj.code;
  
  // Auth errors - need user to reconnect
  if (status === 401 || status === 403) {
    return {
      retryable: false,
      category: 'auth',
      action: 'reconnect'
    };
  }
  
  // Rate limits - retry with backoff
  if (status === 429) {
    return {
      retryable: true,
      category: 'rate_limit',
      action: 'backoff'
    };
  }
  
  // Network errors - retry
  if (errorObj.code === 'ECONNRESET' || errorObj.code === 'ETIMEDOUT' || errorObj.code === 'ENOTFOUND') {
    return {
      retryable: true,
      category: 'network',
      action: 'retry'
    };
  }
  
  // Server errors - retry
  if (status >= 500 && status < 600) {
    return {
      retryable: true,
      category: 'server',
      action: 'retry'
    };
  }
  
  // Client errors (except auth) - don't retry
  if (status >= 400 && status < 500) {
    return {
      retryable: false,
      category: 'client',
      action: 'fail'
    };
  }
  
  // Unknown - attempt retry
  return {
    retryable: true,
    category: 'unknown',
    action: 'retry'
  };
}
```

---

## 15. Verification Checklist

### Initial Connect Flow
- [ ] User clicks "Connect" → Nango popup opens
- [ ] OAuth completes → Nango triggers webhook
- [ ] Webhook validates signature (if NANGO_WEBHOOK_SECRET configured)
- [ ] Webhook creates connection with `last_sync_at = NULL` (NOT current time!)
- [ ] Webhook creates sync_job with trigger='connect', status='pending'
- [ ] Webhook sends Inngest event with jobId
- [ ] Client detects popup closed → starts polling /api/connections
- [ ] Inngest fetches sync_job by jobId (already created)
- [ ] Inngest fetches ALL data (paginated, no arbitrary limits)
- [ ] Inngest DLP scans (batched 20, with retry on 429)
- [ ] Inngest persists data with UPSERT
- [ ] [Calendar] Inngest detects conflicts with sweep line algorithm
- [ ] [Calendar] Inngest runs analysis with Gemini 2.0 Flash
- [ ] Inngest generates embeddings with OpenAI
- [ ] Inngest sets `last_sync_at = now()` AFTER all steps complete
- [ ] Inngest marks sync_job status='complete'
- [ ] Client poll sees `lastSyncAt` is NOT NULL
- [ ] Client generates briefing via POST /api/ai/briefing/generate
- [ ] Client dispatches `eos:connections-updated` with phase='complete'
- [ ] UI updates

### Manual Sync Flow
- [ ] User clicks refresh button
- [ ] SyncManager enqueues sync with trigger='manual'
- [ ] SyncManager filters to connected providers only
- [ ] SyncManager deduplicates queue (same providers within 2s)
- [ ] SyncManager calls /api/integrations/{provider}/sync
- [ ] API creates sync_job and sends Inngest event
- [ ] Inngest uses delta sync (since last_sync_at, or syncToken for calendar)
- [ ] Inngest processes and persists data
- [ ] Inngest calculates dataChanged from DB counts
- [ ] Inngest sets `last_sync_at = now()`
- [ ] API polls until complete or timeout (120s)
- [ ] API returns result with `dataChanged` and `timeChanged` booleans
- [ ] SyncManager generates briefing (ALWAYS for manual, regardless of dataChanged)
- [ ] SyncManager dispatches event
- [ ] UI updates

### Auto Sync Flow
- [ ] 10-minute timer fires (wall-clock aligned: :00, :10, :20, :30, :40, :50)
- [ ] Check for date boundary crossing (UTC midnight) FIRST
- [ ] If date boundary crossed: trigger='date_boundary', regenerate briefing ALWAYS
- [ ] Check for imminent events (30 min threshold)
- [ ] If imminent event found and not already notified: show notification
- [ ] SyncManager enqueues sync with trigger='auto'
- [ ] Inngest processes with delta sync
- [ ] Calculate dataChanged AND timeChanged (for calendar)
- [ ] IF dataChanged=false AND timeChanged=false → skip analysis AND embeddings AND briefing
- [ ] IF dataChanged=false AND timeChanged=true → run analysis, skip embeddings, regenerate briefing
- [ ] IF dataChanged=true → run everything
- [ ] UI updates lastSyncAt timestamp

### Disconnect Flow
- [ ] User clicks "Disconnect"
- [ ] API authenticates user
- [ ] API calls nango.deleteConnection (graceful failure OK)
- [ ] API deletes connection record
- [ ] API deletes provider-specific data (emails/calendar_events/drive_documents)
- [ ] API deletes embeddings with correct `source_type` ('email' not 'gmail'!)
- [ ] API deletes today's briefing using UTC date
- [ ] API regenerates briefing with remaining sources
- [ ] API returns success
- [ ] Client updates state
- [ ] Client dispatches `eos:connections-updated` event
- [ ] UI updates

### Edge Cases
- [ ] All-day calendar events: end date is EXCLUSIVE, subtract 1 day
- [ ] Multi-day events: briefing query uses overlapping time logic
- [ ] Calendar syncToken 410 Gone: clear token, fallback to initial sync
- [ ] syncToken returns events outside window: events are already filtered by Google
- [ ] Cancelled events: DELETE from DB AND from embeddings
- [ ] Nango 401/403: mark connection status='error', prompt reconnect
- [ ] Queue limit reached: max 3 pending, reject additional with toast
- [ ] Deduplication: same providers within 2s window ignored
- [ ] Long content for embeddings: truncate to 8000 chars
- [ ] HTML in calendar description: strip all tags
- [ ] HTML entities in email snippet: decode (&amp; → &)
- [ ] Date boundary at UTC midnight: force re-analysis
- [ ] Imminent event notification: only once per event (track in Set)
- [ ] Gmail Unix timestamp: use SECONDS not milliseconds
- [ ] Briefing date: always use UTC date string 'YYYY-MM-DD'
- [ ] Same-second emails in delta sync: UPSERT handles duplicates

---

## 16. Helper Functions

### 16.1 Focus Block Detection (UTC)

```typescript
interface FocusBlock {
  dateUTC: string;          // 'YYYY-MM-DD'
  startTimeUTC: string;     // ISO timestamp
  endTimeUTC: string;       // ISO timestamp
  durationHours: number;
}

function identifyFocusBlocks(
  events: CalendarEvent[], 
  now: Date
): FocusBlock[] {
  const WORK_DAY_START_HOUR = 9;   // 9 AM UTC
  const WORK_DAY_END_HOUR = 18;    // 6 PM UTC
  const MIN_FOCUS_BLOCK_HOURS = 2;
  
  const focusBlocks: FocusBlock[] = [];
  
  for (let d = 0; d < 7; d++) {
    // Calculate day boundaries in UTC
    const dayStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + d,
      WORK_DAY_START_HOUR, 0, 0, 0
    ));
    
    const dayEnd = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + d,
      WORK_DAY_END_HOUR, 0, 0, 0
    ));
    
    const dateUTC = dayStart.toISOString().split('T')[0];
    
    // Filter events that OVERLAP with work day (not just start within it)
    // An event overlaps if: start < dayEnd AND end > dayStart
    const dayEvents = events
      .filter(e => {
        const start = new Date(e.start_time);
        const end = new Date(e.end_time);
        return start < dayEnd && end > dayStart;
      })
      .sort((a, b) => 
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      );
    
    // Find gaps between meetings
    let currentTime = dayStart;
    
    for (const event of dayEvents) {
      const eventStart = new Date(event.start_time);
      const eventEnd = new Date(event.end_time);
      
      // Clamp event times to work day boundaries
      const effectiveStart = eventStart < dayStart ? dayStart : eventStart;
      const effectiveEnd = eventEnd > dayEnd ? dayEnd : eventEnd;
      
      // Calculate gap before this event
      const gapMs = effectiveStart.getTime() - currentTime.getTime();
      const gapHours = gapMs / (1000 * 60 * 60);
      
      if (gapHours >= MIN_FOCUS_BLOCK_HOURS) {
        focusBlocks.push({
          dateUTC,
          startTimeUTC: currentTime.toISOString(),
          endTimeUTC: effectiveStart.toISOString(),
          durationHours: Math.round(gapHours * 10) / 10
        });
      }
      
      // Move current time to end of this event (clamped to work day)
      if (effectiveEnd > currentTime) {
        currentTime = effectiveEnd;
      }
    }
    
    // Check for focus time after last meeting
    if (currentTime < dayEnd) {
      const remainingMs = dayEnd.getTime() - currentTime.getTime();
      const remainingHours = remainingMs / (1000 * 60 * 60);
      
      if (remainingHours >= MIN_FOCUS_BLOCK_HOURS) {
        focusBlocks.push({
          dateUTC,
          startTimeUTC: currentTime.toISOString(),
          endTimeUTC: dayEnd.toISOString(),
          durationHours: Math.round(remainingHours * 10) / 10
        });
      }
    }
  }
  
  return focusBlocks;
}
```

### 16.2 Back-to-Back Meeting Detection

```typescript
interface BackToBackSequence {
  events: CalendarEvent[];
  totalDurationMinutes: number;
  severity: 'WARNING' | 'CRITICAL';
}

function identifyBackToBackMeetings(
  events: CalendarEvent[]
): BackToBackSequence[] {
  const MAX_GAP_MINUTES = 15;  // Meetings within 15 min = back-to-back
  const MIN_SEQUENCE_LENGTH = 3;
  
  const sequences: BackToBackSequence[] = [];
  
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );
  
  let currentSequence: CalendarEvent[] = [];
  
  for (const event of sortedEvents) {
    if (currentSequence.length === 0) {
      currentSequence.push(event);
      continue;
    }
    
    const lastEvent = currentSequence[currentSequence.length - 1];
    const lastEnd = new Date(lastEvent.end_time);
    const currentStart = new Date(event.start_time);
    const gapMinutes = (currentStart.getTime() - lastEnd.getTime()) / (1000 * 60);
    
    if (gapMinutes <= MAX_GAP_MINUTES) {
      currentSequence.push(event);
    } else {
      // End current sequence
      if (currentSequence.length >= MIN_SEQUENCE_LENGTH) {
        sequences.push(buildSequence(currentSequence));
      }
      currentSequence = [event];
    }
  }
  
  // Don't forget the last sequence
  if (currentSequence.length >= MIN_SEQUENCE_LENGTH) {
    sequences.push(buildSequence(currentSequence));
  }
  
  return sequences;
}

function buildSequence(events: CalendarEvent[]): BackToBackSequence {
  const firstStart = new Date(events[0].start_time);
  const lastEnd = new Date(events[events.length - 1].end_time);
  const totalDurationMinutes = (lastEnd.getTime() - firstStart.getTime()) / (1000 * 60);
  
  return {
    events,
    totalDurationMinutes,
    severity: events.length >= 4 ? 'CRITICAL' : 'WARNING'
  };
}
```

### 16.3 Conflict Detection (Sweep Line Algorithm)

```typescript
function detectConflicts(events: CalendarEvent[]): CalendarEvent[] {
  // O(n log n) sweep line algorithm
  const points: Array<{ time: number; type: 'start' | 'end'; event: CalendarEvent }> = [];
  
  for (const event of events) {
    points.push({
      time: new Date(event.start_time).getTime(),
      type: 'start',
      event
    });
    points.push({
      time: new Date(event.end_time).getTime(),
      type: 'end',
      event
    });
  }
  
  // Sort: by time, then ends before starts (to handle exact overlaps)
  points.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.type === 'end' ? -1 : 1;
  });
  
  const active = new Set<CalendarEvent>();
  const conflicts = new Map<string, Set<string>>();
  
  for (const point of points) {
    if (point.type === 'start') {
      // Mark conflicts with all currently active events
      for (const activeEvent of active) {
        if (!conflicts.has(point.event.event_id)) {
          conflicts.set(point.event.event_id, new Set());
        }
        if (!conflicts.has(activeEvent.event_id)) {
          conflicts.set(activeEvent.event_id, new Set());
        }
        conflicts.get(point.event.event_id)!.add(activeEvent.event_id);
        conflicts.get(activeEvent.event_id)!.add(point.event.event_id);
      }
      active.add(point.event);
    } else {
      active.delete(point.event);
    }
  }
  
  // Update events with conflict info
  return events.map(event => ({
    ...event,
    has_conflict: conflicts.has(event.event_id),
    conflict_with: conflicts.has(event.event_id) 
      ? Array.from(conflicts.get(event.event_id)!)
      : []
  }));
}
```

### 16.4 HTML Utilities

```typescript
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')           // Remove all HTML tags
    .replace(/&nbsp;/g, ' ')           // Non-breaking space
    .replace(/&amp;/g, '&')            // Ampersand
    .replace(/&lt;/g, '<')             // Less than
    .replace(/&gt;/g, '>')             // Greater than
    .replace(/&quot;/g, '"')           // Quote
    .replace(/&#39;/g, "'")            // Apostrophe
    .replace(/\s+/g, ' ')              // Collapse whitespace
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Calculate content hash for embedding deduplication.
 * Used to detect if content has changed and needs re-embedding.
 */
async function calculateContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

### 16.5 Embedding Generation

```typescript
import OpenAI from 'openai';

// Initialize OpenAI client (requires OPENAI_API_KEY env var)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536;
const EMBEDDING_BATCH_SIZE = 100;
const MAX_CONTENT_LENGTH = 8000;  // Characters

interface EmbeddingInput {
  sourceType: 'email' | 'calendar' | 'drive' | 'briefing';
  sourceId: string;           // External ID (message_id, event_id, document_id, briefing.id)
  content: string;            // Text to embed
  metadata?: Record<string, unknown>;
}

/**
 * Generate embeddings for content and upsert to database.
 * Handles batching, deduplication via content_hash, and rate limits.
 */
async function generateAndStoreEmbeddings(
  userId: string,
  inputs: EmbeddingInput[]
): Promise<{ inserted: number; skipped: number }> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[Embeddings] OPENAI_API_KEY not configured, skipping');
    return { inserted: 0, skipped: inputs.length };
  }
  
  let inserted = 0;
  let skipped = 0;
  
  // Process in batches
  for (let i = 0; i < inputs.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = inputs.slice(i, i + EMBEDDING_BATCH_SIZE);
    
    // Prepare content (truncate if necessary)
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
      .in('content_hash', preparedBatch.map(p => p.contentHash));
    
    const existingHashes = new Set(existing?.map(e => e.content_hash) || []);
    const toEmbed = preparedBatch.filter(p => !existingHashes.has(p.contentHash));
    skipped += preparedBatch.length - toEmbed.length;
    
    if (toEmbed.length === 0) continue;
    
    // Call OpenAI Embeddings API
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: toEmbed.map(p => p.content),
      dimensions: EMBEDDING_DIMENSION
    });
    
    // Map embeddings back to inputs
    const records = toEmbed.map((input, idx) => ({
      user_id: userId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      content: input.content,
      embedding: `[${response.data[idx].embedding.join(',')}]`,  // pgvector format
      metadata: input.metadata || {},
      content_hash: input.contentHash
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
  }
  
  return { inserted, skipped };
}

/**
 * Prepare embedding inputs from emails.
 */
function prepareEmailEmbeddings(emails: Email[]): EmbeddingInput[] {
  return emails.map(email => ({
    sourceType: 'email',
    sourceId: email.message_id,  // Gmail message ID, NOT database UUID
    content: `From: ${email.sender}\nSubject: ${email.subject}\n\n${email.snippet || ''}`,
    metadata: {
      sender: email.sender,
      subject: email.subject,
      received_at: email.received_at
    }
  }));
}

/**
 * Prepare embedding inputs from calendar events.
 */
function prepareCalendarEmbeddings(events: CalendarEvent[]): EmbeddingInput[] {
  return events.map(event => ({
    sourceType: 'calendar',
    sourceId: event.event_id,  // Google Calendar event ID, NOT database UUID
    content: `${event.title}\n${event.description || ''}\nLocation: ${event.location || 'N/A'}\nTime: ${event.start_time} to ${event.end_time}`,
    metadata: {
      title: event.title,
      start_time: event.start_time,
      end_time: event.end_time,
      location: event.location
    }
  }));
}

/**
 * Prepare embedding inputs from drive documents.
 */
function prepareDriveEmbeddings(documents: DriveDocument[]): EmbeddingInput[] {
  return documents.map(doc => ({
    sourceType: 'drive',
    sourceId: doc.document_id,  // Google Drive document ID, NOT database UUID
    content: `${doc.name}\n${doc.content_preview || ''}`,
    metadata: {
      name: doc.name,
      mime_type: doc.mime_type,
      modified_at: doc.modified_at
    }
  }));
}

/**
 * Perform hybrid search combining semantic (vector) and keyword search.
 * Uses Reciprocal Rank Fusion (RRF) to merge results.
 */
async function hybridSearch(
  userId: string,
  query: string,
  limit: number = 10
): Promise<SearchResult[]> {
  // 1. Generate query embedding
  const embeddingResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
    dimensions: EMBEDDING_DIMENSION
  });
  const queryEmbedding = embeddingResponse.data[0].embedding;
  
  // 2. Semantic search (vector similarity)
  const { data: semanticResults } = await supabase.rpc('match_embeddings', {
    query_embedding: queryEmbedding,
    match_user_id: userId,
    match_count: limit * 2  // Fetch more for RRF merging
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
  semanticResults?.forEach((r: any, rank: number) => {
    const key = `${r.source_type}:${r.source_id}`;
    const rrfScore = 1 / (K + rank + 1);
    scoreMap.set(key, {
      result: {
        sourceType: r.source_type,
        sourceId: r.source_id,
        content: r.content,
        score: r.similarity,
        metadata: r.metadata
      },
      score: rrfScore
    });
  });
  
  // Add/merge keyword results
  keywordResults?.forEach((r: any, rank: number) => {
    const key = `${r.source_type}:${r.source_id}`;
    const rrfScore = 1 / (K + rank + 1);
    
    if (scoreMap.has(key)) {
      // Already in map, add scores
      scoreMap.get(key)!.score += rrfScore;
    } else {
      scoreMap.set(key, {
        result: {
          sourceType: r.source_type,
          sourceId: r.source_id,
          content: r.content,
          score: rrfScore,
          metadata: r.metadata
        },
        score: rrfScore
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
```

**Required Supabase Function for Vector Search:**

```sql
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
```

### 16.6 Core Business Functions (Referenced)

These functions are called throughout the specification. Their behavior is described here for implementation.

```typescript
/**
 * Generates a briefing for the user based on connected data sources.
 * 
 * BEHAVIOR:
 * 1. Get user's connected sources from `connections` table
 * 2. If no sources connected: delete today's briefing and return success
 * 3. Fetch data from connected sources (emails, events, documents)
 * 4. Build prompt using buildBriefingPrompt() (Section 9.4)
 * 5. Call Gemini LLM using callGeminiJSON()
 * 6. Parse JSON response and validate structure
 * 7. UPSERT into briefings table: { user_id, briefing_date, content: parsedJSON, generated_at }
 * 
 * @param userId - Clerk user ID
 * @returns { success: boolean, briefingId?: string, error?: string }
 */
async function generateBriefingForUser(
  { userId }: { userId: string }
): Promise<{ success: boolean; briefingId?: string; error?: string }>;

/**
 * Runs calendar analysis for strategic insights.
 * 
 * BEHAVIOR:
 * 1. Fetch events in analysis window (7 days past, 14 days future)
 * 2. Run detectConflicts() to identify scheduling conflicts
 * 3. Run identifyFocusBlocks() to find available focus time
 * 4. Build prompt using buildCalendarAnalysisPrompt() (Section 9.3)
 * 5. Call Gemini LLM using callGeminiJSON()
 * 6. Parse JSON response
 * 7. Extract denormalized fields from response.metrics
 * 
 * @param userId - Clerk user ID
 * @returns CalendarAnalysisResult for UPSERT into calendar_insights
 */
async function runCalendarAnalysis(userId: string): Promise<{
  content: Record<string, unknown>;  // Full LLM response
  conflicts_count: number;           // Extracted from content.metrics.conflictCount
  focus_time_hours: number;          // Extracted from content.metrics.focusHoursAvailable
  meeting_hours: number;             // Extracted from content.metrics.meetingHoursTotal
}>;

/**
 * Clears the syncToken from a calendar connection's metadata.
 * Called when Google returns 410 Gone (syncToken expired).
 * 
 * BEHAVIOR:
 * 1. Fetch current connection metadata
 * 2. Remove syncToken key from metadata object
 * 3. Update connection with cleaned metadata
 * 
 * @param connectionId - Database UUID of the connection
 */
async function clearSyncToken(connectionId: string): Promise<void>;
```

---

## 17. Type Definitions

These TypeScript interfaces correspond to database tables and are used throughout the specification.

```typescript
// Matches emails table
interface Email {
  id: string;
  user_id: string;
  message_id: string;
  thread_id: string | null;
  sender: string;
  subject: string;
  snippet: string | null;
  received_at: string;          // ISO timestamp
  is_read: boolean;
  has_attachments: boolean;
  labels: string[];
  security_verified: boolean;
}

// Matches calendar_events table
interface CalendarEvent {
  id: string;
  user_id: string;
  event_id: string;
  title: string;
  description: string | null;
  start_time: string;           // ISO timestamp
  end_time: string;             // ISO timestamp
  is_all_day: boolean;
  location: string | null;
  attendees: Attendee[];
  organizer: string | null;
  has_conflict: boolean;
  conflict_with: string[];
  security_verified: boolean;
}

interface Attendee {
  email: string;
  displayName?: string;
  responseStatus: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  organizer: boolean;
  self: boolean;
}

// Matches drive_documents table
interface DriveDocument {
  id: string;
  user_id: string;
  document_id: string;
  name: string;
  mime_type: string;
  folder_path: string | null;
  modified_at: string | null;   // ISO timestamp
  web_view_link: string | null;
  md5_checksum: string | null;
  content_preview: string | null;
  security_verified: boolean;
}

// Used in calendar analysis prompt
interface ConflictInfo {
  eventA: { event_id: string; title: string; start_time: string; end_time: string };
  eventB: { event_id: string; title: string; start_time: string; end_time: string };
  overlapMinutes: number;
}

// Used in chat system prompt - returned from hybrid search
interface SearchResult {
  sourceType: 'email' | 'calendar' | 'drive' | 'briefing';
  sourceId: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

// Google Calendar API response event (before parsing)
interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
    organizer?: boolean;
    self?: boolean;
  }>;
  organizer?: { email?: string };
  status: 'confirmed' | 'cancelled' | 'tentative';
}

// Used in GET /api/connections response
interface ConnectionStatus {
  status: 'connected' | 'disconnected' | 'error';
  lastSyncAt: string | null;      // ISO timestamp or null
  error: string | null;           // Error reason if status='error'
}

// Core type aliases (canonical definitions - see Section 13)
type ProviderKey = 'gmail' | 'calendar' | 'drive';
type ConfigKey = 'google-mail' | 'google-calendar' | 'google-drive';
type SyncTrigger = 'connect' | 'manual' | 'auto' | 'date_boundary';
type SyncStatus = 'pending' | 'fetching' | 'securing' | 'persisting' | 'analyzing' | 'embedding' | 'complete' | 'error';
```

---

## Appendix: Key Constants

```typescript
// Time boundaries
const GMAIL_INITIAL_DAYS = 7;
const CALENDAR_PAST_DAYS = 7;
const CALENDAR_FUTURE_DAYS = 30;
const CALENDAR_ANALYSIS_PAST_DAYS = 7;
const CALENDAR_ANALYSIS_FUTURE_DAYS = 14;
const DRIVE_INITIAL_DAYS = 14;
const DATA_RETENTION_DAYS = 30;
const SYNC_JOB_RETENTION_DAYS = 7;
const STUCK_JOB_THRESHOLD_HOURS = 24;

// Sync settings
const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;     // 10 minutes
const SYNC_POLL_INTERVAL_MS = 500;                 // 0.5 seconds
const SYNC_POLL_TIMEOUT_MS = 120000;               // 2 minutes
const MAX_QUEUE_LENGTH = 3;
const DEDUP_WINDOW_MS = 2000;                      // 2 seconds
const IMMINENT_EVENT_THRESHOLD_MINUTES = 30;

// DLP settings
const DLP_BATCH_SIZE = 20;
const DLP_MAX_RETRIES = 3;
const DLP_RETRY_DELAYS_MS = [2000, 4000, 8000];   // Exponential backoff

// Embedding settings
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536;
const EMBEDDING_BATCH_SIZE = 100;
const MAX_CONTENT_LENGTH = 8000;                   // Characters

// LLM settings
const LLM_MODEL = 'gemini-2.0-flash';              // CORRECT MODEL
const LLM_JSON_TEMPERATURE = 0;                    // Deterministic (for briefing/analysis)
const LLM_CHAT_TEMPERATURE = 0.7;                  // Slightly creative (for chat)
const LLM_MAX_RETRIES = 3;
const LLM_RETRY_DELAYS_MS = [2000, 4000, 8000];

// API concurrency
const GMAIL_FETCH_CONCURRENCY = 10;
const CALENDAR_FETCH_CONCURRENCY = 10;
const DRIVE_FETCH_CONCURRENCY = 10;

// Cron schedules (UTC)
const MORNING_BRIEFING_CRON = '0 6 * * *';         // 6 AM UTC
const CLEANUP_CRON = '0 3 * * *';                  // 3 AM UTC
```

---