/**
 * EmergentOS - Inngest Functions Index
 * 
 * Exports all Inngest functions for the serve handler.
 */

// Sync functions
export { processGmailSync } from './gmail-sync';
export { processCalendarSync } from './calendar-sync';
export { processDriveSync } from './drive-sync';

// Cron functions
export { generateDailyBriefingCron, generateBriefingForUser, generateCalendarInsightsForUser } from './cron-briefing';
export { cleanupOldDataCron } from './cron-cleanup';

// Export all functions as an array for serve()
import { processGmailSync } from './gmail-sync';
import { processCalendarSync } from './calendar-sync';
import { processDriveSync } from './drive-sync';
import { generateDailyBriefingCron } from './cron-briefing';
import { cleanupOldDataCron } from './cron-cleanup';

export const allFunctions = [
  processGmailSync,
  processCalendarSync,
  processDriveSync,
  generateDailyBriefingCron,
  cleanupOldDataCron,
];
