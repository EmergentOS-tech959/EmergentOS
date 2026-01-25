/**
 * EmergentOS - Briefing Fetch API
 * 
 * GET /api/ai/briefing/[date]
 * Fetches the briefing for a specific date.
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ date: string }> }
) {
  try {
    // 1. Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Extract date from route params
    const { date } = await params;

    // 3. Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    // 4. Fetch briefing from database
    const { data: briefing, error } = await supabase
      .from('briefings')
      .select('id, briefing_date, content, generated_at')
      .eq('user_id', userId)
      .eq('briefing_date', date)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned (not an error for us)
      console.error('[Briefing Fetch] Error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch briefing' },
        { status: 500 }
      );
    }

    if (!briefing) {
      return NextResponse.json({
        found: false,
        briefingDate: date,
        message: 'No briefing found for this date',
      });
    }

    // 5. Return briefing
    return NextResponse.json({
      found: true,
      briefingId: briefing.id,
      briefingDate: briefing.briefing_date,
      generatedAt: briefing.generated_at,
      content: briefing.content,
    });
  } catch (error) {
    console.error('[Briefing Fetch API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
