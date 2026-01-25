/**
 * EmergentOS - Key Constants
 * 
 * All configuration constants from the specification Appendix.
 */

// ============================================================================
// Time Boundaries
// ============================================================================

/** Days of email history to fetch on initial sync */
export const GMAIL_INITIAL_DAYS = 7;

/** Days of past calendar events to fetch */
export const CALENDAR_PAST_DAYS = 7;

/** Days of future calendar events to fetch */
export const CALENDAR_FUTURE_DAYS = 30;

/** Days of past events for calendar analysis */
export const CALENDAR_ANALYSIS_PAST_DAYS = 7;

/** Days of future events for calendar analysis */
export const CALENDAR_ANALYSIS_FUTURE_DAYS = 14;

/** Days of Drive history to fetch on initial sync */
export const DRIVE_INITIAL_DAYS = 14;

/** Days before data is deleted (retention policy) */
export const DATA_RETENTION_DAYS = 30;

/** Days before sync jobs are deleted */
export const SYNC_JOB_RETENTION_DAYS = 7;

/** Hours before a stuck job is cleaned up */
export const STUCK_JOB_THRESHOLD_HOURS = 24;

// ============================================================================
// Sync Settings
// ============================================================================

/** Auto-sync interval in milliseconds (10 minutes) */
export const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;

/** Polling interval for sync completion check */
export const SYNC_POLL_INTERVAL_MS = 500;

/** Maximum time to wait for sync completion */
export const SYNC_POLL_TIMEOUT_MS = 120000;

/** Maximum number of pending sync requests in queue */
export const MAX_QUEUE_LENGTH = 3;

/** Window for deduplicating identical sync requests */
export const DEDUP_WINDOW_MS = 2000;

/** Minutes before an event to trigger imminent notification (client-side) */
export const IMMINENT_EVENT_THRESHOLD_MINUTES = 30;

/** 
 * Imminent Event Re-Analysis Window (server-side)
 * 
 * Events starting between NOW + START and NOW + END minutes trigger briefing regeneration.
 * With 10-minute auto-sync intervals, this guarantees exactly ONE trigger per event.
 * 
 * Example with event at 10:00 AM:
 * - 9:20 sync: window [9:40, 9:50] → 10:00 NOT in window ❌
 * - 9:30 sync: window [9:50, 10:00] → 10:00 IS in (9:50, 10:00] ✅ TRIGGERS
 * - 9:40 sync: window [10:00, 10:10] → 10:00 NOT > 10:00 ❌
 */
export const IMMINENT_REANALYSIS_WINDOW_START_MINUTES = 20;
export const IMMINENT_REANALYSIS_WINDOW_END_MINUTES = 30;

// ============================================================================
// DLP Settings
// ============================================================================

/** Number of items per DLP scan batch */
export const DLP_BATCH_SIZE = 20;

/** Maximum retry attempts for DLP API */
export const DLP_MAX_RETRIES = 3;

/** Retry delays for DLP API (exponential backoff) */
export const DLP_RETRY_DELAYS_MS = [2000, 4000, 8000];

// ============================================================================
// Embedding Settings
// ============================================================================

/** OpenAI embedding model */
export const EMBEDDING_MODEL = 'text-embedding-3-small';

/** Embedding vector dimension */
export const EMBEDDING_DIMENSION = 1536;

/** Number of items per embedding batch */
export const EMBEDDING_BATCH_SIZE = 100;

/** Maximum content length for embedding (characters) */
export const MAX_CONTENT_LENGTH = 8000;

// ============================================================================
// LLM Settings
// ============================================================================

/** Gemini model to use */
export const LLM_MODEL = 'gemini-2.0-flash';

/** Temperature for deterministic JSON output */
export const LLM_JSON_TEMPERATURE = 0;

/** Temperature for chat responses */
export const LLM_CHAT_TEMPERATURE = 0.7;

/** Maximum retry attempts for LLM API */
export const LLM_MAX_RETRIES = 3;

/** Retry delays for LLM API (exponential backoff) */
export const LLM_RETRY_DELAYS_MS = [2000, 4000, 8000];

// ============================================================================
// API Concurrency
// ============================================================================

/** Maximum concurrent Gmail API requests */
export const GMAIL_FETCH_CONCURRENCY = 10;

/** Maximum concurrent Calendar API requests */
export const CALENDAR_FETCH_CONCURRENCY = 10;

/** Maximum concurrent Drive API requests */
export const DRIVE_FETCH_CONCURRENCY = 10;

// ============================================================================
// Cron Schedules (UTC)
// ============================================================================

/** Morning briefing generation time */
export const MORNING_BRIEFING_CRON = '0 6 * * *';

/** Data cleanup time */
export const CLEANUP_CRON = '0 3 * * *';

// ============================================================================
// Work Day Settings (for focus block detection)
// ============================================================================

/** Work day start hour (UTC) */
export const WORK_DAY_START_HOUR = 9;

/** Work day end hour (UTC) */
export const WORK_DAY_END_HOUR = 18;

/** Minimum hours for a focus block */
export const MIN_FOCUS_BLOCK_HOURS = 2;

/** Maximum gap (minutes) between meetings to be "back-to-back" */
export const MAX_BACK_TO_BACK_GAP_MINUTES = 15;

/** Minimum sequence length for back-to-back warning */
export const MIN_BACK_TO_BACK_SEQUENCE = 3;
