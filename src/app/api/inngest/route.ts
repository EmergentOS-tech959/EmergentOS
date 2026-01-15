import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest';
import { functions } from '@/lib/inngest-functions';

/**
 * Inngest API Route Handler
 * 
 * This endpoint serves multiple purposes:
 * 
 * 1. GET /api/inngest
 *    - Returns the Inngest introspection payload
 *    - Used by Inngest to discover and register functions
 *    - Visit this URL to see registered functions
 * 
 * 2. POST /api/inngest
 *    - Receives events from Inngest
 *    - Triggers the appropriate function based on event type
 * 
 * 3. PUT /api/inngest
 *    - Used by Inngest for function execution callbacks
 * 
 * Local Development:
 * - Run `npm run dev:inngest` to start the Inngest dev server
 * - Dev server at http://localhost:8288
 * - It will automatically discover functions from this endpoint
 * 
 * Production:
 * - Register your app at https://app.inngest.com
 * - Sync URL: https://your-app.vercel.app/api/inngest
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: functions,
});

