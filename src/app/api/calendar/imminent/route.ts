/**
 * EmergentOS - Imminent Events API
 * 
 * GET /api/calendar/imminent?threshold=30
 * Checks for events starting within the threshold minutes.
 * Per Section 11.2 - Required for SyncManager imminent event detection.
 * 
 * CRITICAL: Client cannot access Supabase directly (Clerk auth),
 * so this API route is required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { IMMINENT_EVENT_THRESHOLD_MINUTES } from '@/lib/constants';

export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get threshold from query params (default: 30 minutes)
    const searchParams = request.nextUrl.searchParams;
    const threshold = parseInt(searchParams.get('threshold') || String(IMMINENT_EVENT_THRESHOLD_MINUTES), 10);

    // Validate threshold
    if (isNaN(threshold) || threshold < 1 || threshold > 1440) {
      return NextResponse.json(
        { error: 'Invalid threshold. Must be between 1 and 1440 minutes.' },
        { status: 400 }
      );
    }

    // 3. Calculate time window
    const now = new Date();
    const thresholdTime = new Date(now.getTime() + threshold * 60 * 1000);

    // 4. Query for next event starting within threshold
    // Per Section 11.2: SELECT * FROM calendar_events 
    //   WHERE user_id = :userId 
    //   AND start_time > now() 
    //   AND start_time <= now() + :threshold minutes
    //   ORDER BY start_time LIMIT 1
    const { data: event, error } = await supabase
      .from('calendar_events')
      .select('event_id, title, start_time, end_time, location, description')
      .eq('user_id', userId)
      .gt('start_time', now.toISOString())
      .lte('start_time', thresholdTime.toISOString())
      .order('start_time', { ascending: true })
      .limit(1)
      .single();

    // Handle no event found (not an error)
    if (error && error.code === 'PGRST116') {
      return NextResponse.json({
        found: false,
        event: null,
      });
    }

    if (error) {
      console.error('[Imminent Events] Query error:', error);
      return NextResponse.json(
        { error: 'Failed to check imminent events' },
        { status: 500 }
      );
    }

    // 5. Calculate minutes until event
    const minutesUntil = Math.round(
      (new Date(event.start_time).getTime() - now.getTime()) / 60000
    );

    // 6. Return event with enriched data
    return NextResponse.json({
      found: true,
      event: {
        event_id: event.event_id,
        title: event.title,
        start_time: event.start_time,
        end_time: event.end_time,
        location: event.location,
        description: event.description,
        minutesUntil,
      },
    });
  } catch (error) {
    console.error('[Imminent Events API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
