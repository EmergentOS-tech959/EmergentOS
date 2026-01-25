/**
 * EmergentOS - Inngest API Route
 * 
 * Serves all Inngest functions.
 */

import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest';
import { allFunctions } from '@/lib/inngest/index';

// Create and export the serve handler
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: allFunctions,
});
