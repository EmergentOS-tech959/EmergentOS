/**
 * EmergentOS - Calendar Insights API
 * 
 * GET /api/calendar/insights
 * Returns the AI-generated calendar analysis for the authenticated user.
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // 1. Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch calendar insights for user
    const { data: insight, error } = await supabase
      .from('calendar_insights')
      .select('id, content, conflicts_count, focus_time_hours, meeting_hours, generated_at')
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

    // 3. Return insights
    return NextResponse.json({
      found: true,
      insight: {
        id: insight.id,
        content: insight.content,
        conflictsCount: insight.conflicts_count,
        focusTimeHours: insight.focus_time_hours,
        meetingHours: insight.meeting_hours,
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
