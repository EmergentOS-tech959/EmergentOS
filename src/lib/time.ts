/**
 * EmergentOS - Time Boundary Functions
 * 
 * All time operations use UTC as specified in Section 3.
 */

/**
 * Get start of day (00:00:00.000) in UTC
 */
export function startOfDayUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Get end of day (23:59:59.999) in UTC
 */
export function endOfDayUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/**
 * Get date N days ago at start of day (00:00:00.000 UTC)
 */
export function daysAgoUTC(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - days,
    0, 0, 0, 0
  ));
}

/**
 * Get date N days from now at end of day (23:59:59.999 UTC)
 */
export function daysFromNowUTC(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + days,
    23, 59, 59, 999
  ));
}

/**
 * Convert Date to Unix seconds (for Gmail API)
 * CRITICAL: Gmail uses SECONDS, not milliseconds!
 */
export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Get current UTC date as YYYY-MM-DD string
 */
export function getCurrentUTCDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Check if a date string represents today (UTC)
 */
export function isToday(dateString: string): boolean {
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
export function isThisWeek(dateString: string): boolean {
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

/**
 * Format a date as a human-readable time ago string
 */
export function formatTimeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return d.toLocaleDateString();
}

/**
 * Calculate milliseconds until next 10-minute boundary
 * Used for wall-clock aligned auto-sync
 */
export function msUntilNextTenMinuteMark(): number {
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const ms = now.getMilliseconds();
  
  const nextInterval = Math.ceil((minutes + 1) / 10) * 10;
  const minutesToNext = nextInterval - minutes;
  const msUntilNext = (minutesToNext * 60 - seconds) * 1000 - ms;
  
  return msUntilNext > 0 ? msUntilNext : 600000; // 10 min fallback
}
