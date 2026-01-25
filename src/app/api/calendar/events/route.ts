/**
 * EmergentOS - Calendar Events API
 * 
 * GET /api/calendar/events
 * Fetches calendar events for display in the dashboard.
 * Supports query params: today=true, from=ISO, to=ISO
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { startOfDayUTC, endOfDayUTC } from '@/lib/time';

export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const today = searchParams.get('today') === 'true';
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    // 3. Determine time range
    const now = new Date();
    let fromTime: string;
    let toTime: string;

    if (today) {
      // Today's events (including multi-day events that overlap with today)
      const todayStart = startOfDayUTC(now);
      const tomorrowEnd = endOfDayUTC(new Date(now.getTime() + 24 * 60 * 60 * 1000));
      fromTime = todayStart.toISOString();
      toTime = tomorrowEnd.toISOString();
    } else if (fromParam && toParam) {
      // Custom range
      fromTime = new Date(fromParam).toISOString();
      toTime = new Date(toParam).toISOString();
    } else {
      // Default: next 7 days
      fromTime = startOfDayUTC(now).toISOString();
      toTime = endOfDayUTC(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)).toISOString();
    }

    // 4. Query events (including multi-day events that overlap with the range)
    // An event overlaps if: start_time <= toTime AND end_time >= fromTime
    const { data: events, error } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('user_id', userId)
      .lte('start_time', toTime)
      .gte('end_time', fromTime)
      .order('start_time', { ascending: true });

    if (error) {
      console.error('[Calendar Events] Query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch events' },
        { status: 500 }
      );
    }

    // 5. Filter to today-only if requested (for exact day match)
    let filteredEvents = events || [];
    if (today) {
      const todayDate = now.toISOString().split('T')[0];
      filteredEvents = filteredEvents.filter(event => {
        const eventStart = new Date(event.start_time);
        const eventEnd = new Date(event.end_time);
        const todayStart = startOfDayUTC(now);
        const todayEnd = endOfDayUTC(now);
        
        // Event is relevant if it overlaps with today
        return eventStart <= todayEnd && eventEnd >= todayStart;
      });
    }

    // 6. Return events with count
    return NextResponse.json({
      events: filteredEvents,
      count: filteredEvents.length,
      range: { from: fromTime, to: toTime },
    });
  } catch (error) {
    console.error('[Calendar Events API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
