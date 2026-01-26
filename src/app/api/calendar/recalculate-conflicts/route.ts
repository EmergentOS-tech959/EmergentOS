/**
 * EmergentOS - Recalculate Calendar Conflicts API
 * 
 * POST /api/calendar/recalculate-conflicts
 * Recalculates conflict flags for all calendar events for the authenticated user.
 * This is useful when events were synced before the conflict detection bug was fixed.
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { detectConflicts } from '@/lib/helpers';

export async function POST() {
  try {
    // 1. Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`[Recalculate Conflicts] Starting for user ${userId}`);

    // 2. Fetch ALL events for this user
    const { data: events, error: fetchError } = await supabase
      .from('calendar_events')
      .select('id, event_id, start_time, end_time, title')
      .eq('user_id', userId);

    if (fetchError) {
      console.error('[Recalculate Conflicts] Fetch error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch events' },
        { status: 500 }
      );
    }

    if (!events || events.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No events to process',
        eventsProcessed: 0,
        conflictsFound: 0,
      });
    }

    console.log(`[Recalculate Conflicts] Found ${events.length} events`);

    // 3. Detect conflicts across ALL events
    const eventsWithConflicts = detectConflicts(events);
    
    const conflictingEvents = eventsWithConflicts.filter(e => e.has_conflict);
    console.log(`[Recalculate Conflicts] Detected ${conflictingEvents.length} events with conflicts`);

    // 4. Update ALL events with new conflict flags
    let updatedCount = 0;
    let errorCount = 0;

    for (const event of eventsWithConflicts) {
      const { error: updateError } = await supabase
        .from('calendar_events')
        .update({ 
          has_conflict: event.has_conflict, 
          conflict_with: event.conflict_with 
        })
        .eq('id', event.id);

      if (updateError) {
        console.error(`[Recalculate Conflicts] Update error for event ${event.event_id}:`, updateError);
        errorCount++;
      } else {
        updatedCount++;
      }
    }

    console.log(`[Recalculate Conflicts] Completed: ${updatedCount} updated, ${errorCount} errors`);

    // 5. Return summary
    return NextResponse.json({
      success: true,
      eventsProcessed: events.length,
      conflictsFound: conflictingEvents.length,
      eventsUpdated: updatedCount,
      errors: errorCount,
      conflictingEventTitles: conflictingEvents.map(e => e.title),
    });
  } catch (error) {
    console.error('[Recalculate Conflicts API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
