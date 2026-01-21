/**
 * EmergentOS - COMPLETE DATA LIFECYCLE SPECIFICATION
 * Version: 2.0 (Final) | Last Updated: January 20, 2026
 * 
 * CORE PRINCIPLES:
 * 1. NO DATA LIMITS - Fetch ALL data within the defined time period using pagination
 * 2. DAY BOUNDARIES - All time periods use calendar day boundaries (00:00:00 to 23:59:59 UTC)
 *    Exception: Delta sync uses exact timestamps
 * 3. PAGINATION - Always paginate through ALL pages of API results
 * 4. EFFICIENCY - Delta sync fetches only NEW data since last sync
 * 5. USER CONTROL - Manual refresh ALWAYS triggers full reprocessing
 */

// ============================================================================
// TIME BOUNDARY HELPERS
// ============================================================================

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

export function startOfDaysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return startOfDay(d);
}

export function endOfDaysFromNow(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return endOfDay(d);
}

export function startOfYesterday(): Date {
  return startOfDaysAgo(1);
}

export function startOfToday(): Date {
  return startOfDay(new Date());
}

export function endOfToday(): Date {
  return endOfDay(new Date());
}

export function endOfTomorrow(): Date {
  return endOfDaysFromNow(1);
}

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

// ============================================================================
// SYNC RESULT TYPE (for change detection)
// ============================================================================

export interface SyncResult {
  provider: 'gmail' | 'calendar' | 'drive';
  totalFetched: number;   // How many items were fetched from API
  inserted: number;       // How many new items were added to DB
  updated: number;        // How many existing items were modified
  deleted: number;        // How many items were removed (calendar delta)
  dataChanged: boolean;   // inserted > 0 || updated > 0 || deleted > 0
}

// ============================================================================
// GMAIL CONFIGURATION
// ============================================================================

export const GmailConfig = {
  /**
   * INITIAL SYNC (first connection)
   * - Period: 7 days (day boundaries)
   * - From: 7 days ago at 00:00:00 UTC
   * - To: Today at 23:59:59 UTC
   * - Pagination: Fetch ALL emails (no limit)
   */
  initialSync: {
    periodDays: 7,
    getTimeRange: () => ({
      from: startOfDaysAgo(7),
      to: endOfToday(),
    }),
    getGmailQuery: () => {
      const afterUnix = toUnixSeconds(startOfDaysAgo(7));
      return `in:inbox after:${afterUnix}`;
    },
    // Per-page size for pagination (NOT total limit)
    // Fetch ALL emails by following nextPageToken until null
    pageSize: 100,
  },

  /**
   * DELTA SYNC (subsequent syncs)
   * - Period: Since last sync (exact timestamp)
   * - From: connections.last_sync_at (exact time)
   * - To: Now
   * - Only fetches NEW emails since last sync
   */
  deltaSync: {
    getTimeRange: (lastSyncTime: Date) => ({
      from: lastSyncTime,
      to: new Date(),
    }),
    getGmailQuery: (lastSyncTime: Date) => {
      const afterUnix = toUnixSeconds(lastSyncTime);
      return `in:inbox after:${afterUnix}`;
    },
    // Per-page size for pagination
    pageSize: 100,
  },

  /**
   * BRIEFING (for AI daily briefing)
   * - Period: Since yesterday start
   * - From: Yesterday at 00:00:00 UTC
   * - To: Now
   */
  briefing: {
    getTimeRange: () => ({
      from: startOfYesterday(),
      to: new Date(),
    }),
  },

  /**
   * CLEANUP
   * - Delete data older than 30 days
   */
  cleanup: {
    retentionDays: 30,
    getDeleteBefore: () => startOfDaysAgo(30),
  },
} as const;

// ============================================================================
// CALENDAR CONFIGURATION
// ============================================================================

export const CalendarConfig = {
  /**
   * INITIAL SYNC (first connection)
   * - Past: 7 days (for context)
   * - Future: 30 days
   * - From: 7 days ago at 00:00:00 UTC
   * - To: 30 days from now at 23:59:59 UTC
   * - Pagination: Fetch ALL events (no limit)
   */
  initialSync: {
    pastDays: 7,
    futureDays: 30,
    getTimeRange: () => ({
      from: startOfDaysAgo(7),
      to: endOfDaysFromNow(30),
    }),
    // Per-page size for pagination (NOT total limit)
    pageSize: 100,
  },

  /**
   * DELTA SYNC (subsequent syncs)
   * - Method: Google Calendar syncToken
   * - Returns: Only events that changed since token was issued
   * - Fallback: If syncToken invalid (410 Gone), do full initial sync
   */
  deltaSync: {
    useSyncToken: true,
    fallbackTimeRange: () => ({
      from: startOfDaysAgo(7),
      to: endOfDaysFromNow(30),
    }),
    // Per-page size for pagination
    pageSize: 100,
  },

  /**
   * BRIEFING (for AI daily briefing)
   * - From: Today at 00:00:00 UTC
   * - To: Tomorrow at 23:59:59 UTC
   * - Reason: Include tomorrow's events for preparation
   */
  briefing: {
    getTimeRange: () => ({
      from: startOfToday(),
      to: endOfTomorrow(),
    }),
  },

  /**
   * ANALYSIS (for calendar insights/conflicts)
   * - Past: 7 days (for patterns)
   * - Future: 14 days (for upcoming conflicts)
   */
  analysis: {
    pastDays: 7,
    futureDays: 14,
    getTimeRange: () => ({
      from: startOfDaysAgo(7),
      to: endOfDaysFromNow(14),
    }),
  },

  /**
   * CLEANUP
   * - Delete events older than 30 days in the past
   */
  cleanup: {
    retentionDays: 30,
    getDeleteBefore: () => startOfDaysAgo(30),
  },
} as const;

// ============================================================================
// DRIVE CONFIGURATION
// ============================================================================

export const DriveConfig = {
  /**
   * INITIAL SYNC (first connection)
   * - Period: 14 days (documents are worked on over weeks)
   * - From: 14 days ago at 00:00:00 UTC
   * - To: Now
   * - Pagination: Fetch ALL files (no limit)
   */
  initialSync: {
    periodDays: 14,
    getTimeRange: () => ({
      from: startOfDaysAgo(14),
      to: new Date(),
    }),
    // Per-page size for pagination (NOT total limit)
    pageSize: 100,
  },

  /**
   * DELTA SYNC (subsequent syncs)
   * - From: connections.last_sync_at (exact timestamp)
   * - To: Now
   * - Query: modifiedTime > last_sync_at AND trashed = false
   */
  deltaSync: {
    getTimeRange: (lastSyncTime: Date) => ({
      from: lastSyncTime,
      to: new Date(),
    }),
    // Per-page size for pagination
    pageSize: 100,
  },

  /**
   * BRIEFING (for AI daily briefing)
   * - From: Yesterday at 00:00:00 UTC
   * - To: Now
   */
  briefing: {
    getTimeRange: () => ({
      from: startOfYesterday(),
      to: new Date(),
    }),
  },

  /**
   * CLEANUP
   * - Delete file records older than 30 days
   */
  cleanup: {
    retentionDays: 30,
    getDeleteBefore: () => startOfDaysAgo(30),
  },
} as const;

// ============================================================================
// BRIEFING CONFIGURATION
// ============================================================================

export const BriefingConfig = {
  triggers: {
    afterSync: true,
    afterConnectionChange: true,
    scheduledHour: 6,
  },
  cleanup: {
    retentionDays: 30,
    getDeleteBefore: () => startOfDaysAgo(30),
  },
} as const;

// ============================================================================
// AUTO-SYNC CONFIGURATION
// ============================================================================

export const AutoSyncConfig = {
  intervalMinutes: 10,
  wallClockAligned: true,
  syncAllSources: true,
  // CRITICAL: Only regenerate briefing if data actually changed
  regenerateBriefingOnChange: true,
} as const;

// ============================================================================
// SEARCH CONFIGURATION (NO TIME RESTRICTIONS - searches all embedded data)
// ============================================================================

export const SearchConfig = {
  semantic: {
    topK: 15,
    similarityThreshold: 0.60,
  },
  keyword: {
    topK: 15,
  },
  final: {
    limit: 10,
  },
  chat: {
    contextLimit: 8,
    historyLimit: 8,
  },
  rrfConstant: 60,
} as const;

// ============================================================================
// CLEANUP CONFIGURATION
// ============================================================================

export const CleanupConfig = {
  scheduleHour: 3,
  cronExpression: '0 3 * * *',
  retentionDays: 30,
} as const;

// ============================================================================
// DISCONNECT BEHAVIOR
// ============================================================================

export const DisconnectConfig = {
  deleteAllData: true,
  deleteEmbeddings: true,
  deleteTodayBriefing: true,
  regenerateBriefing: true,
} as const;

// ============================================================================
// TRIGGER TYPES (for change detection)
// ============================================================================

export type SyncTrigger = 'connect' | 'disconnect' | 'manual' | 'auto';

/**
 * Determines whether to regenerate briefing based on trigger and data change
 */
export function shouldRegenerateBriefing(
  trigger: SyncTrigger,
  dataChanged: boolean
): boolean {
  switch (trigger) {
    case 'connect':
      return true; // Always - new source connected
    case 'disconnect':
      return true; // Always - source removed
    case 'manual':
      return true; // Always - user explicitly requested refresh
    case 'auto':
      return dataChanged; // Only if data actually changed
    default:
      return true;
  }
}

// ============================================================================
// COMBINED EXPORT
// ============================================================================

export const DataScopeConfig = {
  gmail: GmailConfig,
  calendar: CalendarConfig,
  drive: DriveConfig,
  briefing: BriefingConfig,
  autoSync: AutoSyncConfig,
  search: SearchConfig,
  cleanup: CleanupConfig,
  disconnect: DisconnectConfig,
} as const;

export default DataScopeConfig;
