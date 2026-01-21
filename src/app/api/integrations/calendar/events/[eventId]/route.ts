import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { Nango } from '@nangohq/node';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { scanContent } from '@/lib/nightfall';
import { upsertPiiVaultTokens } from '@/lib/pii-vault';
import { findCalendarConflicts } from '@/lib/calendar-analysis';
import { generateBriefingForUser } from '@/lib/briefing-generator';

// Helper to get connection ID
async function getConnectionId(userId: string, supa: SupabaseClient): Promise<string | null> {
  const { data: direct } = await supa
    .from('connections')
    .select('connection_id')
    .eq('user_id', userId)
    .eq('provider', 'calendar')
    .maybeSingle();

  const directId = (direct as { connection_id?: string } | null)?.connection_id;
  if (directId) return directId;

  const { data: meta } = await supa
    .from('connections')
    .select('connection_id')
    .eq('provider', 'calendar')
    .contains('metadata', { clerk_user_id: userId })
    .maybeSingle();

  return (meta as { connection_id?: string } | null)?.connection_id || null;
}

// Helper to re-run conflict detection for a user's events
async function redetectConflicts(userId: string, supa: SupabaseClient): Promise<void> {
  // Fetch all events for the user within analysis window (today + 7 days)
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const { data: allEvents } = await supa
    .from('calendar_events')
    .select('event_id, title, start_time, end_time, location, status')
    .eq('user_id', userId)
    .gte('start_time', now.toISOString())
    .lte('start_time', windowEnd.toISOString())
    .order('start_time', { ascending: true });

  if (!allEvents || allEvents.length === 0) return;

  // Run conflict detection
  const { conflicts } = findCalendarConflicts(allEvents);

  // Update all events with their conflict status
  for (const event of allEvents) {
    const hasConflict = !!conflicts[event.event_id] && conflicts[event.event_id].length > 0;
    const conflictWith = conflicts[event.event_id] || [];

    await supa
      .from('calendar_events')
      .update({ has_conflict: hasConflict, conflict_with: conflictWith })
      .eq('user_id', userId)
      .eq('event_id', event.event_id);
  }
}

/**
 * PUT /api/integrations/calendar/events/[eventId]
 * Updates an existing calendar event in Google Calendar and local database
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { eventId } = await params;
    if (!eventId) return NextResponse.json({ error: 'Missing eventId' }, { status: 400 });

    const nangoSecretKey = process.env.NANGO_SECRET_KEY;
    if (!nangoSecretKey) {
      return NextResponse.json({ error: 'Nango not configured' }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      description?: string;
      start_time?: string;
      end_time?: string;
      location?: string;
    };

    // At least one field must be provided for update
    if (!body.title && !body.description && !body.start_time && !body.end_time && !body.location) {
      return NextResponse.json(
        { error: 'At least one field (title, description, start_time, end_time, location) is required' },
        { status: 400 }
      );
    }

    const supa = supabaseAdmin as unknown as SupabaseClient;

    const connectionId = await getConnectionId(userId, supa);
    if (!connectionId) {
      return NextResponse.json({ error: 'Calendar not connected' }, { status: 400 });
    }

    // Build the Google Calendar API update payload
    const googleUpdateData: Record<string, unknown> = {};
    if (body.title !== undefined) googleUpdateData.summary = body.title;
    if (body.description !== undefined) googleUpdateData.description = body.description;
    if (body.location !== undefined) googleUpdateData.location = body.location;
    if (body.start_time !== undefined) googleUpdateData.start = { dateTime: body.start_time };
    if (body.end_time !== undefined) googleUpdateData.end = { dateTime: body.end_time };

    const nango = new Nango({ secretKey: nangoSecretKey });

    // Update event in Google Calendar via Nango proxy (PATCH for partial update)
    const updateRes = await nango.proxy({
      connectionId: String(connectionId),
      providerConfigKey: 'google-calendar',
      method: 'PATCH',
      endpoint: `/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      data: googleUpdateData,
    });

    const updated = updateRes.data as { id?: string; summary?: string };
    if (!updated?.id) {
      console.error('Google Calendar update failed', updateRes);
      return NextResponse.json({ error: 'Failed to update event in Google Calendar' }, { status: 500 });
    }

    // DLP scan for storage (tokenize sensitive data)
    let redactedTitle = body.title;
    let redactedDescription = body.description;
    let redactedLocation = body.location;

    if (body.title || body.description || body.location) {
      try {
        const contentToScan = `${body.title || ''}\n${body.description || ''}\n${body.location || ''}`;
        const scanned = await scanContent(contentToScan);
        await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });
        
        const lines = scanned.redacted.split('\n');
        if (body.title !== undefined) redactedTitle = lines[0] || body.title;
        if (body.description !== undefined) redactedDescription = lines[1] || body.description;
        if (body.location !== undefined) redactedLocation = lines.slice(2).join('\n').trim() || body.location;
      } catch (dlpError) {
        // Graceful DLP failure - proceed without redaction
        console.warn('[Calendar Event Update] DLP scan failed, proceeding without redaction:', dlpError);
      }
    }

    // Build local database update payload
    const dbUpdateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (redactedTitle !== undefined) dbUpdateData.title = redactedTitle;
    if (redactedDescription !== undefined) dbUpdateData.description = redactedDescription;
    if (redactedLocation !== undefined) dbUpdateData.location = redactedLocation;
    if (body.start_time !== undefined) dbUpdateData.start_time = body.start_time;
    if (body.end_time !== undefined) dbUpdateData.end_time = body.end_time;

    // Update in Supabase
    const { error: upsertError } = await supa
      .from('calendar_events')
      .update(dbUpdateData)
      .eq('user_id', userId)
      .eq('event_id', eventId);

    if (upsertError) {
      console.error('Failed to update calendar event in database', upsertError);
      // Event was updated in Google, so this is a partial success
    }

    // Re-run conflict detection if time changed
    if (body.start_time || body.end_time) {
      try {
        await redetectConflicts(userId, supa);
        console.log('[Calendar Event Update] Conflict re-detection completed');
      } catch (conflictError) {
        console.error('[Calendar Event Update] Conflict re-detection failed:', conflictError);
      }
    }

    // CRITICAL: Regenerate briefing after event update
    // Calendar data changed, so briefing should reflect the updated event
    try {
      console.log('[Calendar Event Update] Triggering briefing regeneration');
      await generateBriefingForUser({ userId });
      console.log('[Calendar Event Update] Briefing regenerated successfully');
    } catch (briefingError) {
      console.error('[Calendar Event Update] Briefing regeneration failed:', briefingError);
      // Don't fail the request - event was updated successfully
    }

    return NextResponse.json({ 
      success: true, 
      eventId: updated.id,
      timeChanged: !!(body.start_time || body.end_time),
      briefingRegenerated: true,
    });
  } catch (error) {
    console.error('Error updating calendar event', error);
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
}

/**
 * DELETE /api/integrations/calendar/events/[eventId]
 * Deletes an event from Google Calendar and local database
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { eventId } = await params;
    if (!eventId) return NextResponse.json({ error: 'Missing eventId' }, { status: 400 });

    const nangoSecretKey = process.env.NANGO_SECRET_KEY;
    if (!nangoSecretKey) {
      return NextResponse.json({ error: 'Nango not configured' }, { status: 500 });
    }

    const supa = supabaseAdmin as unknown as SupabaseClient;

    const connectionId = await getConnectionId(userId, supa);
    if (!connectionId) {
      return NextResponse.json({ error: 'Calendar not connected' }, { status: 400 });
    }

    const nango = new Nango({ secretKey: nangoSecretKey });
    await nango.proxy({
      connectionId: String(connectionId),
      providerConfigKey: 'google-calendar',
      method: 'DELETE',
      endpoint: `/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    });

    await supa.from('calendar_events').delete().eq('user_id', userId).eq('event_id', eventId);

    // Re-run conflict detection after deletion (may resolve conflicts)
    try {
      await redetectConflicts(userId, supa);
      console.log('[Calendar Event Delete] Conflict re-detection completed');
    } catch (conflictError) {
      console.error('[Calendar Event Delete] Conflict re-detection failed:', conflictError);
    }

    // CRITICAL: Regenerate briefing after event deletion
    // Calendar data changed, so briefing should reflect the removed event
    try {
      console.log('[Calendar Event Delete] Triggering briefing regeneration');
      await generateBriefingForUser({ userId });
      console.log('[Calendar Event Delete] Briefing regenerated successfully');
    } catch (briefingError) {
      console.error('[Calendar Event Delete] Briefing regeneration failed:', briefingError);
      // Don't fail the request - event was deleted successfully
    }

    return NextResponse.json({ success: true, briefingRegenerated: true });
  } catch (error) {
    console.error('Error deleting calendar event', error);
    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 });
  }
}

/**
 * GET /api/integrations/calendar/events/[eventId]
 * Fetches a single event by ID
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { eventId } = await params;
    if (!eventId) return NextResponse.json({ error: 'Missing eventId' }, { status: 400 });

    const supa = supabaseAdmin as unknown as SupabaseClient;

    const { data, error } = await supa
      .from('calendar_events')
      .select('*')
      .eq('user_id', userId)
      .eq('event_id', eventId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching event', error);
      return NextResponse.json({ error: 'Failed to fetch event' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    return NextResponse.json({ event: data });
  } catch (error) {
    console.error('Error fetching calendar event', error);
    return NextResponse.json({ error: 'Failed to fetch event' }, { status: 500 });
  }
}
