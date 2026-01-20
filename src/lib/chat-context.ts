/**
 * EmergentOS - Chat Context Builder
 * 
 * Builds a comprehensive, dynamic context for AI prompts including:
 * - Current date/time
 * - Data source connection status
 * - Last sync times
 * - Data counts
 * - User preferences
 */

import { supabaseAdmin } from './supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';

const supa = supabaseAdmin as unknown as SupabaseClient;

export interface DataSourceStatus {
  provider: 'gmail' | 'calendar' | 'drive';
  connected: boolean;
  lastSyncAt: string | null;
  itemCount: number;
}

export interface UserContext {
  // Time context
  currentDate: string;           // "2026-01-20"
  currentTime: string;           // "14:30 UTC"
  currentDayOfWeek: string;      // "Monday"
  timezone: string;              // "UTC" (default, can be user preference later)
  
  // Data source status
  dataSources: DataSourceStatus[];
  connectedSources: string[];    // ["gmail", "calendar"]
  disconnectedSources: string[]; // ["drive"]
  
  // Data summary
  totalEmails: number;
  totalEvents: number;
  totalDocuments: number;
  todayEventsCount: number;
  upcomingEventsCount: number;   // Next 7 days
  
  // Briefing status
  hasTodayBriefing: boolean;
  lastBriefingDate: string | null;
  
  // Search capability
  hasEmbeddings: boolean;
  embeddingsCount: number;
}

/**
 * Get current date/time information
 */
function getTimeContext(): Pick<UserContext, 'currentDate' | 'currentTime' | 'currentDayOfWeek' | 'timezone'> {
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  return {
    currentDate: now.toISOString().split('T')[0],
    currentTime: now.toISOString().split('T')[1].slice(0, 5) + ' UTC',
    currentDayOfWeek: days[now.getUTCDay()],
    timezone: 'UTC',
  };
}

/**
 * Fetch complete user context for AI prompts
 */
export async function getUserContext(userId: string): Promise<UserContext> {
  const timeContext = getTimeContext();
  const today = timeContext.currentDate;
  const todayStart = `${today}T00:00:00Z`;
  const todayEnd = `${today}T23:59:59Z`;
  const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch all data in parallel
  const [
    connectionsResult,
    emailCountResult,
    allEventsResult,
    todayEventsResult,
    upcomingEventsResult,
    docsCountResult,
    briefingResult,
    embeddingsCountResult,
  ] = await Promise.all([
    // Connections
    supa
      .from('connections')
      .select('provider, status, last_sync_at')
      .eq('user_id', userId)
      .in('provider', ['gmail', 'calendar', 'drive']),
    
    // Email count
    supa
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    
    // All events count
    supa
      .from('calendar_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    
    // Today's events count
    supa
      .from('calendar_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('start_time', todayStart)
      .lte('start_time', todayEnd),
    
    // Upcoming events (next 7 days)
    supa
      .from('calendar_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('start_time', todayStart)
      .lte('start_time', weekEnd),
    
    // Documents count
    supa
      .from('drive_documents')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    
    // Today's briefing
    supa
      .from('briefings')
      .select('briefing_date')
      .eq('user_id', userId)
      .order('briefing_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    
    // Embeddings count
    supa
      .from('embeddings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ]);

  // Process connections
  const connections = (connectionsResult.data || []) as Array<{
    provider: string;
    status: string;
    last_sync_at: string | null;
  }>;

  const connectionMap = new Map(connections.map(c => [c.provider, c]));
  
  const dataSources: DataSourceStatus[] = ['gmail', 'calendar', 'drive'].map(provider => {
    const conn = connectionMap.get(provider);
    let itemCount = 0;
    if (provider === 'gmail') itemCount = emailCountResult.count || 0;
    if (provider === 'calendar') itemCount = allEventsResult.count || 0;
    if (provider === 'drive') itemCount = docsCountResult.count || 0;
    
    return {
      provider: provider as 'gmail' | 'calendar' | 'drive',
      connected: conn?.status === 'connected',
      lastSyncAt: conn?.last_sync_at || null,
      itemCount,
    };
  });

  const connectedSources = dataSources.filter(s => s.connected).map(s => s.provider);
  const disconnectedSources = dataSources.filter(s => !s.connected).map(s => s.provider);

  // Briefing info
  const lastBriefingDate = (briefingResult.data as { briefing_date?: string } | null)?.briefing_date || null;
  const hasTodayBriefing = lastBriefingDate === today;

  return {
    ...timeContext,
    dataSources,
    connectedSources,
    disconnectedSources,
    totalEmails: emailCountResult.count || 0,
    totalEvents: allEventsResult.count || 0,
    totalDocuments: docsCountResult.count || 0,
    todayEventsCount: todayEventsResult.count || 0,
    upcomingEventsCount: upcomingEventsResult.count || 0,
    hasTodayBriefing,
    lastBriefingDate,
    hasEmbeddings: (embeddingsCountResult.count || 0) > 0,
    embeddingsCount: embeddingsCountResult.count || 0,
  };
}

/**
 * Build the system context section for AI prompts
 */
export function buildSystemContext(ctx: UserContext): string {
  const lines: string[] = [
    `## System Context`,
    ``,
    `### Current Time`,
    `- Date: ${ctx.currentDate} (${ctx.currentDayOfWeek})`,
    `- Time: ${ctx.currentTime}`,
    ``,
    `### Data Source Status`,
  ];

  for (const source of ctx.dataSources) {
    const status = source.connected ? '✓ Connected' : '✗ Not Connected';
    const lastSync = source.lastSyncAt 
      ? `Last sync: ${new Date(source.lastSyncAt).toISOString()}`
      : 'Never synced';
    const count = source.connected ? `${source.itemCount} items` : 'No data';
    
    lines.push(`- **${source.provider.charAt(0).toUpperCase() + source.provider.slice(1)}**: ${status} | ${lastSync} | ${count}`);
  }

  lines.push(``);
  lines.push(`### Data Summary`);
  lines.push(`- Emails: ${ctx.totalEmails}`);
  lines.push(`- Calendar Events: ${ctx.totalEvents} total (${ctx.todayEventsCount} today, ${ctx.upcomingEventsCount} this week)`);
  lines.push(`- Documents: ${ctx.totalDocuments}`);
  lines.push(`- Search Index: ${ctx.hasEmbeddings ? `${ctx.embeddingsCount} items indexed` : 'Not available'}`);
  
  if (ctx.hasTodayBriefing) {
    lines.push(`- Daily Briefing: Generated for today`);
  } else if (ctx.lastBriefingDate) {
    lines.push(`- Daily Briefing: Last generated on ${ctx.lastBriefingDate}`);
  } else {
    lines.push(`- Daily Briefing: Not yet generated`);
  }

  lines.push(``);
  
  // Add warnings for disconnected sources
  if (ctx.disconnectedSources.length > 0) {
    lines.push(`### ⚠️ Limitations`);
    for (const source of ctx.disconnectedSources) {
      switch (source) {
        case 'gmail':
          lines.push(`- Gmail is not connected. Cannot answer questions about emails.`);
          break;
        case 'calendar':
          lines.push(`- Calendar is not connected. Cannot answer questions about schedule or meetings.`);
          break;
        case 'drive':
          lines.push(`- Drive is not connected. Cannot answer questions about documents.`);
          break;
      }
    }
    lines.push(``);
  }

  return lines.join('\n');
}

/**
 * Build a complete prompt with system context + search results + user message
 */
export function buildCompletePrompt(args: {
  systemContext: string;
  searchContext: string;
  history: Array<{ role: string; content: string }>;
  userMessage: string;
}): string {
  const historyText = args.history
    .slice(-8) // Last 8 messages (4 exchanges)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  return [
    `You are EmergentOS, a secure executive assistant for C-level executives.`,
    ``,
    `## Critical Guidelines`,
    `1. All user data is tokenized (e.g., [PERSON_001]) for security. Do NOT guess or reveal original values.`,
    `2. Use ONLY the provided context to answer questions. If information is not available, say so clearly.`,
    `3. Be aware of the current date/time when answering time-related questions.`,
    `4. If a data source is not connected, inform the user they need to connect it first.`,
    `5. Be concise, professional, and actionable.`,
    `6. When citing sources, use format [source:id] like [email:abc123] or [calendar:xyz789].`,
    `7. Provide strategic insights, not just raw data summaries.`,
    ``,
    args.systemContext,
    args.searchContext,
    `## Chat History (most recent last)`,
    historyText || '(none)',
    ``,
    `## User Question`,
    args.userMessage,
    ``,
    `## Your Response`,
  ].join('\n');
}
