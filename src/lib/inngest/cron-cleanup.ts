/**
 * EmergentOS - Data Cleanup Cron
 * 
 * Cleans up old data at 3 AM UTC.
 * Per Section 10.3.
 */

import { inngest } from '../inngest';
import { supabase } from '../supabase';
import { daysAgoUTC } from '../time';
import {
  DATA_RETENTION_DAYS,
  SYNC_JOB_RETENTION_DAYS,
  STUCK_JOB_THRESHOLD_HOURS,
  CLEANUP_CRON,
} from '../constants';

// ============================================================================
// Cleanup Cron Function
// ============================================================================

export const cleanupOldDataCron = inngest.createFunction(
  {
    id: 'cleanup-old-data-cron',
    name: 'Data Retention Cleanup',
  },
  { cron: CLEANUP_CRON },  // 3 AM UTC
  async ({ step }) => {
    console.log('[Cleanup Cron] Starting data retention cleanup');

    const cutoffDate = daysAgoUTC(DATA_RETENTION_DAYS).toISOString();
    const syncJobCutoff = daysAgoUTC(SYNC_JOB_RETENTION_DAYS).toISOString();

    // Step 1: Delete old emails
    const emailsDeleted = await step.run('cleanup-emails', async () => {
      const { count, error } = await supabase
        .from('emails')
        .delete({ count: 'exact' })
        .lt('received_at', cutoffDate);

      if (error) {
        console.error('[Cleanup] Error deleting emails:', error);
        return 0;
      }

      console.log(`[Cleanup] Deleted ${count || 0} old emails`);
      return count || 0;
    });

    // Step 2: Delete old calendar events
    const eventsDeleted = await step.run('cleanup-calendar-events', async () => {
      const { count, error } = await supabase
        .from('calendar_events')
        .delete({ count: 'exact' })
        .lt('end_time', cutoffDate);

      if (error) {
        console.error('[Cleanup] Error deleting calendar events:', error);
        return 0;
      }

      console.log(`[Cleanup] Deleted ${count || 0} old calendar events`);
      return count || 0;
    });

    // Step 3: Delete old drive documents
    const docsDeleted = await step.run('cleanup-drive-documents', async () => {
      const { count, error } = await supabase
        .from('drive_documents')
        .delete({ count: 'exact' })
        .lt('modified_at', cutoffDate);

      if (error) {
        console.error('[Cleanup] Error deleting drive documents:', error);
        return 0;
      }

      console.log(`[Cleanup] Deleted ${count || 0} old drive documents`);
      return count || 0;
    });

    // Step 4: Delete old briefings (keep last 30 days)
    const briefingsDeleted = await step.run('cleanup-briefings', async () => {
      const cutoffDateOnly = cutoffDate.split('T')[0];
      const { count, error } = await supabase
        .from('briefings')
        .delete({ count: 'exact' })
        .lt('briefing_date', cutoffDateOnly);

      if (error) {
        console.error('[Cleanup] Error deleting briefings:', error);
        return 0;
      }

      console.log(`[Cleanup] Deleted ${count || 0} old briefings`);
      return count || 0;
    });

    // Step 5: Delete old sync jobs (completed or stuck)
    const syncJobsDeleted = await step.run('cleanup-sync-jobs', async () => {
      // Delete completed jobs older than 7 days
      const { count: completedCount, error: completedError } = await supabase
        .from('sync_jobs')
        .delete({ count: 'exact' })
        .lt('completed_at', syncJobCutoff);

      if (completedError) {
        console.error('[Cleanup] Error deleting completed sync jobs:', completedError);
      }

      // Delete stuck jobs (never completed, started > 24 hours ago)
      const stuckCutoff = new Date(Date.now() - STUCK_JOB_THRESHOLD_HOURS * 60 * 60 * 1000).toISOString();
      const { count: stuckCount, error: stuckError } = await supabase
        .from('sync_jobs')
        .delete({ count: 'exact' })
        .is('completed_at', null)
        .lt('started_at', stuckCutoff);

      if (stuckError) {
        console.error('[Cleanup] Error deleting stuck sync jobs:', stuckError);
      }

      const total = (completedCount || 0) + (stuckCount || 0);
      console.log(`[Cleanup] Deleted ${completedCount || 0} completed + ${stuckCount || 0} stuck sync jobs`);
      return total;
    });

    // Step 6: Delete orphaned embeddings
    const orphanedDeleted = await step.run('cleanup-orphaned-embeddings', async () => {
      try {
        const { data, error } = await supabase.rpc('delete_orphaned_embeddings');

        if (error) {
          console.error('[Cleanup] Error calling delete_orphaned_embeddings:', error);
          return 0;
        }

        console.log(`[Cleanup] Deleted ${data || 0} orphaned embeddings`);
        return data || 0;
      } catch (error) {
        console.error('[Cleanup] Error in orphaned embeddings cleanup:', error);
        return 0;
      }
    });

    const totalDeleted = emailsDeleted + eventsDeleted + docsDeleted + briefingsDeleted + syncJobsDeleted + orphanedDeleted;

    console.log(`[Cleanup Cron] Complete - Total deleted: ${totalDeleted}`);

    return {
      emailsDeleted,
      eventsDeleted,
      docsDeleted,
      briefingsDeleted,
      syncJobsDeleted,
      orphanedDeleted,
      totalDeleted,
    };
  }
);
