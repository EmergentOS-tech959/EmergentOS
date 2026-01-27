/**
 * EmergentOS - Briefing Generation API
 * 
 * POST /api/ai/briefing/generate
 * Generates a daily briefing for the authenticated user.
 * Per Section 16.6.
 * 
 * Enhanced with:
 * - User profile personalization from onboarding
 * - Structured output schema enforcement
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { callGeminiWithSchema, isGeminiConfigured, BRIEFING_SCHEMA } from '@/lib/llm/gemini';
import { buildBriefingPrompt, type UserProfileContext } from '@/lib/llm/prompts';
import { getCurrentUTCDate, daysAgoUTC, startOfDayUTC, endOfDayUTC } from '@/lib/time';

export async function POST() {
  try {
    // 1. Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Check Gemini configuration
    if (!isGeminiConfigured()) {
      return NextResponse.json(
        { error: 'Gemini API not configured' },
        { status: 503 }
      );
    }

    // 3. Get user's connected sources
    const { data: connections } = await supabase
      .from('connections')
      .select('provider, status')
      .eq('user_id', userId)
      .eq('status', 'connected');

    const connectedSources = {
      gmail: connections?.some((c) => c.provider === 'gmail') || false,
      calendar: connections?.some((c) => c.provider === 'calendar') || false,
      drive: connections?.some((c) => c.provider === 'drive') || false,
    };

    // 4. If no sources connected, delete today's briefing and return
    const todayUTC = getCurrentUTCDate();
    if (!connectedSources.gmail && !connectedSources.calendar && !connectedSources.drive) {
      await supabase
        .from('briefings')
        .delete()
        .eq('user_id', userId)
        .eq('briefing_date', todayUTC);

      return NextResponse.json({
        success: true,
        message: 'No connected sources, briefing cleared',
      });
    }

    // 5. Fetch data from connected sources
    const yesterday = daysAgoUTC(1).toISOString();
    const now = new Date();
    const todayStartUTC = startOfDayUTC(now).toISOString();
    const tomorrowEndUTC = endOfDayUTC(new Date(now.getTime() + 24 * 60 * 60 * 1000)).toISOString();

    // Emails (last 24 hours)
    let emails: Array<{
      sender: string;
      subject: string;
      snippet: string | null;
      received_at: string;
    }> = [];
    if (connectedSources.gmail) {
      const { data } = await supabase
        .from('emails')
        .select('sender, subject, snippet, received_at')
        .eq('user_id', userId)
        .gte('received_at', yesterday)
        .order('received_at', { ascending: false });
      emails = data || [];
    }

    // Calendar events (today and tomorrow, including multi-day events)
    let events: Array<{
      event_id: string;
      title: string;
      description: string | null;
      start_time: string;
      end_time: string;
      is_all_day: boolean;
      location: string | null;
      attendees: unknown[];
      has_conflict: boolean;
      conflict_with: string[];
    }> = [];
    if (connectedSources.calendar) {
      const { data } = await supabase
        .from('calendar_events')
        .select('event_id, title, description, start_time, end_time, is_all_day, location, attendees, has_conflict, conflict_with')
        .eq('user_id', userId)
        .lte('start_time', tomorrowEndUTC)
        .gte('end_time', todayStartUTC)
        .order('start_time', { ascending: true });
      events = data || [];
    }

    // Drive documents (last 24 hours)
    let documents: Array<{
      name: string;
      mime_type: string;
      modified_at: string | null;
    }> = [];
    if (connectedSources.drive) {
      const { data } = await supabase
        .from('drive_documents')
        .select('name, mime_type, modified_at')
        .eq('user_id', userId)
        .gte('modified_at', yesterday)
        .order('modified_at', { ascending: false });
      documents = data || [];
    }

    // 6. Fetch user profile for personalization (from onboarding)
    // Require BOTH onboarding_answers AND ai_assessment for full personalization
    let userProfile: UserProfileContext = { hasOnboarding: false };
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('onboarding_answers, ai_assessment')
      .eq('user_id', userId)
      .single();

    // Full personalization requires completed onboarding (both fields populated)
    const hasCompleteOnboarding = !!(profile?.onboarding_answers && profile?.ai_assessment);
    
    if (profile) {
      userProfile = {
        hasOnboarding: hasCompleteOnboarding,
        answers: profile.onboarding_answers as UserProfileContext['answers'],
        assessment: profile.ai_assessment as UserProfileContext['assessment'],
      };
    }

    // 7. Build prompt and call Gemini with schema enforcement
    const prompt = buildBriefingPrompt(emails, events, documents, connectedSources, userProfile);
    
    console.log(`[Briefing] Generating briefing for user ${userId}, personalized: ${userProfile.hasOnboarding}`);
    const responseText = await callGeminiWithSchema(prompt, BRIEFING_SCHEMA);

    // 8. Parse JSON response (schema enforced, but validate anyway)
    let content: Record<string, unknown>;
    try {
      content = JSON.parse(responseText);
    } catch {
      console.error('[Briefing] Failed to parse Gemini response:', responseText);
      return NextResponse.json(
        { error: 'Failed to parse briefing response' },
        { status: 500 }
      );
    }

    // 9. UPSERT into briefings table
    const { data: briefing, error: upsertError } = await supabase
      .from('briefings')
      .upsert(
        {
          user_id: userId,
          briefing_date: todayUTC,
          content,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,briefing_date' }
      )
      .select('id')
      .single();

    if (upsertError) {
      console.error('[Briefing] UPSERT error:', upsertError);
      return NextResponse.json(
        { error: 'Failed to save briefing' },
        { status: 500 }
      );
    }

    console.log(`[Briefing] Briefing generated for user ${userId}, id: ${briefing?.id}`);

    return NextResponse.json({
      success: true,
      briefingId: briefing?.id,
      briefingDate: todayUTC,
    });
  } catch (error) {
    console.error('[Briefing API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
