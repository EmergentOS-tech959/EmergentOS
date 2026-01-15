import { inngest } from './inngest';
import { Nango } from '@nangohq/node';
import { createClient } from '@supabase/supabase-js';

/**
 * Initialize Nango client for Gmail API access
 */
const nango = new Nango({ 
  secretKey: process.env.NANGO_SECRET_KEY! 
});

/**
 * Initialize Supabase admin client (bypasses RLS)
 * Used for server-side operations from Inngest
 */
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Email metadata structure from Gmail API
 */
interface GmailHeader {
  name: string;
  value: string;
}

// GmailMessageDetail interface - kept for future use with full message parsing
// interface GmailMessageDetail {
//   id: string;
//   payload: {
//     headers: GmailHeader[];
//   };
// }

interface ParsedEmail {
  id: string;
  from: string;
  subject: string;
  date: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PROCESS GMAIL CONNECTION - THE CORE TEST FUNCTION
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This function is triggered when a user connects their Gmail via Nango.
 * It demonstrates the "blocking DLP" architecture that Rob wants to validate.
 * 
 * Flow:
 * 1. Update status to "fetching"
 * 2. Fetch last 5 emails from Gmail via Nango proxy
 * 3. Update status to "securing"
 * 4. ⭐ MOCK DLP SCAN - 2 SECOND BLOCKING DELAY ⭐
 * 5. Persist emails to Supabase (only after DLP clears)
 * 6. Update status to "complete"
 * 
 * The 2-second delay simulates the latency of a real Nightfall DLP scan.
 * This allows Rob to physically feel the UX trade-off of blocking security.
 */
export const processGmailConnection = inngest.createFunction(
  {
    id: 'process-gmail-connection',
    name: 'Process Gmail Connection',
    retries: 3,
  },
  { event: 'gmail/connection.established' },
  async ({ event, step, logger }) => {
    // userId = Clerk user ID (for Supabase)
    // connectionId = Nango connection ID (for Nango API calls)
    const { userId, connectionId } = event.data;
    const nangoConnectionId = connectionId || userId; // Fallback for backwards compatibility
    
    logger.info(`Processing Gmail connection for user: ${userId}, nangoConnection: ${nangoConnectionId}`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Update status to "fetching"
    // ═══════════════════════════════════════════════════════════════
    await step.run('update-status-fetching', async () => {
      logger.info('Step 1: Updating status to fetching');
      
      const { error } = await supabaseAdmin
        .from('sync_status')
        .upsert({
          user_id: userId,
          status: 'fetching',
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
        });

      if (error) {
        logger.error('Failed to update status to fetching', { error });
        throw error;
      }
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Fetch emails from Gmail via Nango proxy
    // ═══════════════════════════════════════════════════════════════
    const emails = await step.run('fetch-gmail-emails', async () => {
      logger.info('Step 2: Fetching emails from Gmail via Nango');

      try {
        // Get list of message IDs
        const listResponse = await nango.proxy({
          connectionId: nangoConnectionId,
          providerConfigKey: 'google-mail',
          method: 'GET',
          endpoint: '/gmail/v1/users/me/messages',
          params: { 
            maxResults: '5',
            q: 'in:inbox', // Only inbox messages
          },
        });

        const messages = listResponse.data?.messages || [];
        logger.info(`Found ${messages.length} messages`);

        if (messages.length === 0) {
          return [];
        }

        // Fetch details for each message
        const emailDetails: ParsedEmail[] = await Promise.all(
          messages.slice(0, 5).map(async (msg: { id: string }) => {
            const detailResponse = await nango.proxy({
              connectionId: nangoConnectionId,
              providerConfigKey: 'google-mail',
              method: 'GET',
              endpoint: `/gmail/v1/users/me/messages/${msg.id}`,
              params: { 
                format: 'full', // Use full format to get all headers
              },
            });
            
            // Log the full response structure to debug
            const responseData = detailResponse.data;
            logger.info(`Message ${msg.id} keys:`, Object.keys(responseData || {}));
            
            // Gmail API can return headers in different locations
            // Try multiple paths to find the headers
            let headers: GmailHeader[] = [];
            
            if (responseData?.payload?.headers) {
              headers = responseData.payload.headers;
              logger.info(`Found ${headers.length} headers in payload.headers`);
            } else if (Array.isArray(responseData?.headers)) {
              headers = responseData.headers;
              logger.info(`Found ${headers.length} headers in headers`);
            } else {
              logger.warn(`No headers found. Response structure:`, JSON.stringify(responseData, null, 2).substring(0, 500));
            }

            const getHeader = (name: string): string => {
              const header = headers.find(
                (h: GmailHeader) => h.name?.toLowerCase() === name.toLowerCase()
              );
              const value = header?.value || 'Unknown';
              logger.info(`Header ${name}: ${value.substring(0, 50)}`);
              return value;
            };

            return {
              id: msg.id,
              from: getHeader('From'),
              subject: getHeader('Subject'),
              date: getHeader('Date'),
            };
          })
        );

        logger.info(`Fetched details for ${emailDetails.length} emails`);
        return emailDetails;

      } catch (error) {
        logger.error('Failed to fetch emails from Gmail', { error });
        throw error;
      }
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Update status to "securing"
    // ═══════════════════════════════════════════════════════════════
    await step.run('update-status-securing', async () => {
      logger.info('Step 3: Updating status to securing');
      
      const { error } = await supabaseAdmin
        .from('sync_status')
        .upsert({
          user_id: userId,
          status: 'securing',
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
        });

      if (error) {
        logger.error('Failed to update status to securing', { error });
        throw error;
      }
    });

    // ═══════════════════════════════════════════════════════════════
    // ⭐⭐⭐ STEP 4: MOCK DLP SECURITY GATE - THE CORE TEST ⭐⭐⭐
    // ═══════════════════════════════════════════════════════════════
    // This 2-second delay simulates the latency of a real Nightfall
    // DLP scan. In production, this would be replaced with actual
    // Nightfall API calls to scan email content for PII.
    //
    // PURPOSE: Allow Rob to physically feel the UX impact of a
    // blocking security architecture vs. an optimistic UI approach.
    // ═══════════════════════════════════════════════════════════════
    await step.sleep('mock-dlp-scan', '2s');
    
    logger.info('Step 4: Mock DLP scan completed (2 second delay)');

    // ═══════════════════════════════════════════════════════════════
    // STEP 5: Persist emails to Supabase (only after DLP clears)
    // ═══════════════════════════════════════════════════════════════
    await step.run('persist-emails', async () => {
      logger.info('Step 5: Persisting emails to Supabase');

      // Clear existing emails for this user
      const { error: deleteError } = await supabaseAdmin
        .from('emails')
        .delete()
        .eq('user_id', userId);

      if (deleteError) {
        logger.error('Failed to delete existing emails', { deleteError });
        // Continue anyway - might be first sync
      }

      // Insert new emails
      if (emails.length > 0) {
        const emailsToInsert = emails.map((email: ParsedEmail) => ({
          user_id: userId,
          message_id: email.id,
          sender: email.from,
          subject: email.subject || 'No Subject',
          received_at: email.date,
          security_verified: true,
        }));

        const { error: insertError } = await supabaseAdmin
          .from('emails')
          .insert(emailsToInsert);

        if (insertError) {
          logger.error('Failed to insert emails', { insertError });
          throw insertError;
        }

        logger.info(`Inserted ${emailsToInsert.length} emails`);
      }
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 6: Update status to "complete"
    // ═══════════════════════════════════════════════════════════════
    await step.run('update-status-complete', async () => {
      logger.info('Step 6: Updating status to complete');
      
      const { error } = await supabaseAdmin
        .from('sync_status')
        .upsert({
          user_id: userId,
          status: 'complete',
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
        });

      if (error) {
        logger.error('Failed to update status to complete', { error });
        throw error;
      }
    });

    logger.info(`Gmail sync complete for user ${userId}. Processed ${emails.length} emails.`);

    return { 
      success: true,
      userId,
      emailsProcessed: emails.length,
      timestamp: new Date().toISOString(),
    };
  }
);

/**
 * Export all functions for the Inngest serve handler
 */
export const functions = [processGmailConnection];

