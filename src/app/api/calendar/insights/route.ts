/**
 * EmergentOS - Calendar Insights API
 * 
 * GET /api/calendar/insights
 * Returns the AI-generated calendar analysis for the authenticated user.
 * 
 * POST /api/calendar/insights
 * Triggers calendar analysis regeneration.
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { daysAgoUTC, daysFromNowUTC } from '@/lib/time';
import { getConflictDetails, identifyFocusBlocks } from '@/lib/helpers';
import { buildCalendarAnalysisPrompt, type UserProfileContext } from '@/lib/llm/prompts';
import { callGeminiWithSchema, CALENDAR_ANALYSIS_SCHEMA, isGeminiConfigured } from '@/lib/llm/gemini';
import { CALENDAR_ANALYSIS_PAST_DAYS, CALENDAR_ANALYSIS_FUTURE_DAYS } from '@/lib/constants';

export async function GET() {
  try {
    // 1. Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch calendar insights for user (including new health_score and verdict fields)
    const { data: insight, error } = await supabase
      .from('calendar_insights')
      .select('id, content, conflicts_count, focus_time_hours, meeting_hours, health_score, verdict, generated_at')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned (not an error for us)
      console.error('[Calendar Insights] Error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch insights' },
        { status: 500 }
      );
    }

    if (!insight) {
      return NextResponse.json({
        found: false,
        message: 'No calendar insights available. Connect your calendar and sync to generate insights.',
      });
    }

    // 3. Return insights with enhanced fields
    return NextResponse.json({
      found: true,
      insight: {
        id: insight.id,
        content: insight.content,
        conflictsCount: insight.conflicts_count,
        focusTimeHours: insight.focus_time_hours,
        meetingHours: insight.meeting_hours,
        healthScore: insight.health_score,
        verdict: insight.verdict,
        generatedAt: insight.generated_at,
      },
    });
  } catch (error) {
    console.error('[Calendar Insights API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST - Trigger calendar analysis regeneration
 * Called when briefing regenerates but calendar analysis didn't run during sync
 */
export async function POST() {
  try {
    // 1. Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Check if Gemini is configured
    if (!isGeminiConfigured()) {
      return NextResponse.json(
        { error: 'AI analysis not configured' },
        { status: 503 }
      );
    }

    // 3. Check if calendar is connected
    const { data: connection } = await supabase
      .from('connections')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', 'calendar')
      .eq('status', 'connected')
      .single();

    if (!connection) {
      return NextResponse.json({
        success: false,
        message: 'Calendar not connected',
      });
    }

    console.log(`[Calendar Insights] Triggering analysis for user ${userId}`);

    // 4. Run calendar analysis
    const analysisResult = await runCalendarAnalysis(userId);

    // 5. UPSERT into calendar_insights
    const { error: upsertError } = await supabase
      .from('calendar_insights')
      .upsert({
        user_id: userId,
        content: analysisResult.content,
        conflicts_count: analysisResult.conflicts_count,
        focus_time_hours: analysisResult.focus_time_hours,
        meeting_hours: analysisResult.meeting_hours,
        health_score: analysisResult.health_score,
        verdict: analysisResult.verdict,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (upsertError) {
      console.error('[Calendar Insights] Upsert error:', upsertError);
      return NextResponse.json(
        { error: 'Failed to save insights' },
        { status: 500 }
      );
    }

    console.log(`[Calendar Insights] Analysis complete: score=${analysisResult.health_score}, verdict=${analysisResult.verdict}`);

    return NextResponse.json({
      success: true,
      healthScore: analysisResult.health_score,
      verdict: analysisResult.verdict,
    });
  } catch (error) {
    console.error('[Calendar Insights API] POST Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Run calendar analysis (copied from calendar-sync.ts to avoid circular deps)
 */
async function runCalendarAnalysis(userId: string): Promise<{
  content: Record<string, unknown>;
  conflicts_count: number;
  focus_time_hours: number;
  meeting_hours: number;
  health_score: number;
  verdict: string;
}> {
  // Fetch events in analysis window
  const pastDate = daysAgoUTC(CALENDAR_ANALYSIS_PAST_DAYS).toISOString();
  const futureDate = daysFromNowUTC(CALENDAR_ANALYSIS_FUTURE_DAYS).toISOString();

  const { data: events } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('user_id', userId)
    .gte('start_time', pastDate)
    .lte('start_time', futureDate)
    .order('start_time', { ascending: true });

  // Fetch user profile for personalization
  const { data: userProfile } = await supabase
    .from('user_profiles')
    .select('onboarding_status, onboarding_answers, ai_assessment')
    .eq('user_id', userId)
    .single();

  const profileContext: UserProfileContext = {
    hasOnboarding: userProfile?.onboarding_status === 'completed',
    answers: userProfile?.onboarding_answers as UserProfileContext['answers'],
    assessment: userProfile?.ai_assessment as UserProfileContext['assessment'],
  };

  const calendarEvents = (events || []).map((e) => ({
    event_id: e.event_id,
    title: e.title,
    description: e.description,
    start_time: e.start_time,
    end_time: e.end_time,
    is_all_day: e.is_all_day,
    location: e.location,
    attendees: e.attendees as unknown[],
    organizer: e.organizer,
    has_conflict: e.has_conflict,
    conflict_with: e.conflict_with || [],
  }));

  const conflicts = getConflictDetails(calendarEvents);
  const focusBlocks = identifyFocusBlocks(calendarEvents, new Date());

  const prompt = buildCalendarAnalysisPrompt(calendarEvents, conflicts, focusBlocks, profileContext);
  const responseText = await callGeminiWithSchema(prompt, CALENDAR_ANALYSIS_SCHEMA);

  let content: Record<string, unknown>;
  try {
    content = JSON.parse(responseText);
  } catch {
    console.error('[Calendar Insights] Failed to parse analysis response:', responseText);
    content = { error: 'Failed to parse analysis', raw: responseText };
  }

  const metrics = (content.metrics || {}) as Record<string, number>;
  const healthScore = (content.healthScore as number) || 50;
  const verdict = (content.verdict as string) || 'MODERATE';

  return {
    content,
    conflicts_count: metrics.conflictCount ?? conflicts.length,
    focus_time_hours: metrics.focusHoursAvailable ?? focusBlocks.reduce((sum, b) => sum + b.durationHours, 0),
    meeting_hours: metrics.meetingHoursTotal ?? 0,
    health_score: healthScore,
    verdict,
  };
}
