/**
 * EmergentOS - LLM Prompts
 * 
 * Prompt templates per Section 9.3, 9.4, 9.5.
 */

import { isToday, isThisWeek } from '../time';
import { identifyBackToBackMeetings, type CalendarEvent, type FocusBlock, type ConflictInfo } from '../helpers';

// ============================================================================
// Types
// ============================================================================

interface Email {
  sender: string;
  subject: string;
  snippet: string | null;
  received_at: string;
}

interface DriveDocument {
  name: string;
  mime_type: string;
  modified_at: string | null;
}

interface SearchResult {
  sourceType: string;
  content: string;
  metadata: Record<string, unknown>;
}

// ============================================================================
// Calendar Analysis Prompt (Section 9.3)
// ============================================================================

export function buildCalendarAnalysisPrompt(
  events: CalendarEvent[],
  conflicts: ConflictInfo[],
  focusBlocks: FocusBlock[]
): string {
  const now = new Date();
  const currentTimeUTC = now.toISOString();
  const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getUTCDay()];

  const todayEvents = events.filter((e) => isToday(e.start_time));
  const thisWeekEvents = events.filter((e) => isThisWeek(e.start_time));

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
${JSON.stringify(events.map((e) => ({
  title: e.title,
  start: e.start_time,
  end: e.end_time,
  duration_minutes: (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000,
  attendees_count: e.attendees?.length || 0,
  has_conflict: e.has_conflict,
  location: e.location,
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

// ============================================================================
// Daily Briefing Prompt (Section 9.4)
// ============================================================================

export function buildBriefingPrompt(
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
    .filter((e) => new Date(e.start_time) > now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const nextEvent = upcomingEvents[0];
  const minutesToNextEvent = nextEvent
    ? Math.round((new Date(nextEvent.start_time).getTime() - now.getTime()) / 60000)
    : null;

  // Identify VIP/urgent emails
  const urgentKeywords = ['urgent', 'asap', 'immediately', 'critical', 'deadline', 'eod', 'cob'];
  const urgentEmails = emails.filter((e) =>
    urgentKeywords.some((kw) =>
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
${connectedSources.gmail ? JSON.stringify(emails.map((e) => ({
  from: e.sender,
  subject: e.subject,
  snippet: e.snippet?.substring(0, 100),
  received: e.received_at,
  is_potentially_urgent: urgentEmails.includes(e),
})), null, 2) : 'Gmail not connected'}

## TODAY'S SCHEDULE
${connectedSources.calendar ? JSON.stringify(events.filter((e) => isToday(e.start_time)).map((e) => ({
  title: e.title,
  start: e.start_time,
  end: e.end_time,
  location: e.location,
  attendees_count: e.attendees?.length || 0,
  has_conflict: e.has_conflict,
})), null, 2) : 'Calendar not connected'}

## RECENT DOCUMENTS
${connectedSources.drive ? JSON.stringify(documents.slice(0, 10).map((d) => ({
  name: d.name,
  type: d.mime_type,
  modified: d.modified_at,
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

// ============================================================================
// Chat System Prompt (Section 9.5)
// ============================================================================

export function buildChatSystemPrompt(
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
${searchContext.length > 0 ? JSON.stringify(searchContext.map((r) => ({
  type: r.sourceType,
  content: r.content,
  metadata: r.metadata,
})), null, 2) : 'No specific context found for this query.'}

## GUIDELINES
1. USE the search context above to answer questions with specific data
2. If data contains security tokens like [PERSON_001], display them as-is
3. Only mention disconnected sources if the user specifically asks about them
4. Cite sources when referencing specific emails, events, or documents
5. For time-related questions, consider the current UTC time

Provide helpful, accurate responses based on the user's connected data.`;
}

// ============================================================================
// Onboarding Prompts
// ============================================================================

import type { OnboardingAnswers } from '../onboarding/types';

/**
 * Smart Recap Generation Prompt
 * Generates a professional, personalized summary of user's onboarding responses.
 */
export function buildSmartRecapPrompt(answers: OnboardingAnswers): string {
  return `You are generating a professional Smart Recap for EmergentOS onboarding.

## USER'S ANSWERS
${JSON.stringify(answers, null, 2)}

## YOUR TASK
Create a warm, professional summary that:
1. Synthesizes their responses into a cohesive narrative
2. Shows genuine understanding of their situation
3. Highlights the key themes and priorities
4. Feels personalized, not template-like

## FORMAT
Write a 2-3 paragraph recap in second person ("You're focused on...", "You tend to...").
Make it feel like a thoughtful observation from someone who listened carefully.
End with the question: "Does that sound about right?"

## EXAMPLE STRUCTURE
"You're focused on [their goal], and it's clear this is a top priority for you right now. When it comes to decisions, you [their style], which tells me [insight]. You feel most in flow when [their trigger], and the main thing that tends to derail you is [their blocker]. Right now, the most helpful thing I can do is [their immediate need].

[Add insight from context questions if present]

Does that sound about right?"

## RULES
- Be warm but professional
- Use their actual words and details where possible
- Keep it concise (2-3 paragraphs max)
- Always end with "Does that sound about right?"
- Do NOT include any JSON formatting or markdown code blocks
- Return ONLY the plain text recap

Respond with ONLY the recap text. No JSON, no markdown formatting, no code blocks.`;
}

/**
 * User Assessment Generation Prompt
 * Creates a comprehensive assessment for personalizing the EmergentOS experience.
 */
export function buildUserAssessmentPrompt(
  answers: OnboardingAnswers,
  confirmedRecap: string
): string {
  return `You are an executive profiling system for EmergentOS. Based on the user's onboarding responses, generate a comprehensive assessment that will personalize their experience.

## USER'S RESPONSES
${JSON.stringify(answers, null, 2)}

## RECAP CONFIRMED BY USER
${confirmedRecap}

## YOUR TASK
Generate a detailed JSON assessment that will be used to personalize their EmergentOS experience. Analyze their responses to understand:
- How they make decisions (analytical vs intuitive)
- When they're most productive
- What causes friction in their work
- What motivates them
- What they need help with most

## OUTPUT FORMAT
Respond with ONLY valid JSON in this exact format (no markdown code fences, no extra text):
{
  "profileSummary": "A 2-3 sentence executive summary of this user's profile and working style",
  "workStyle": {
    "decisionApproach": "analytical" | "intuitive" | "collaborative" | "deliberate",
    "energyPattern": "morning_peak" | "afternoon_peak" | "evening_peak" | "steady",
    "collaborationStyle": "async_preferred" | "sync_preferred" | "mixed"
  },
  "priorities": ["Top 3-5 priorities based on their responses, as strings"],
  "suggestedFocus": ["3-5 specific recommendations for how EmergentOS can help them"],
  "personalityInsights": {
    "driverTraits": ["2-3 key motivating traits that drive them"],
    "stressors": ["2-3 things that cause friction or stress"],
    "motivators": ["2-3 things that energize and motivate them"]
  }
}

## RULES
- Base all insights on the actual answers provided
- Be specific and actionable in recommendations
- Use professional but accessible language
- Return ONLY the JSON object, no additional text or formatting`;
}
