import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { Nango } from '@nangohq/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { scanContent } from '@/lib/nightfall';
import { upsertPiiVaultTokens } from '@/lib/pii-vault';
import { generateBriefingForUser } from '@/lib/briefing-generator';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = supabaseAdmin;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('user_id', userId)
    .gte('start_time', todayStart.toISOString())
    .lte('start_time', todayEnd.toISOString())
    .order('start_time', { ascending: true });

  if (error) {
    console.error('Error fetching calendar events', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }

  // Map event_id to id for frontend compatibility
  // Frontend uses 'id' to refer to events, but we store 'event_id' (Google Calendar ID)
  type CalendarEventRow = {
    id: string;
    event_id: string;
    title: string;
    start_time: string;
    end_time: string;
    location?: string;
    description?: string;
    has_conflict: boolean;
    status: string;
    attendees?: unknown[];
    [key: string]: unknown;
  };
  const mappedEvents = ((data || []) as CalendarEventRow[]).map(event => ({
    ...event,
    id: event.event_id, // Use Google Calendar event_id as the primary identifier
  }));

  return NextResponse.json({ events: mappedEvents });
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

    if (!body.title || !body.start_time || !body.end_time) {
      return NextResponse.json(
        { error: 'Missing required fields: title, start_time, end_time' },
        { status: 400 }
      );
    }

    const supa = supabaseAdmin as unknown as SupabaseClient;

    // Find connectionId by Clerk userId (and legacy metadata mapping)
    const { data: direct } = await supa
      .from('connections')
      .select('connection_id')
      .eq('user_id', userId)
      .eq('provider', 'calendar')
      .maybeSingle();

    const directId = (direct as { connection_id?: string } | null)?.connection_id;
    const { data: meta } = directId
      ? { data: null }
      : await supa
          .from('connections')
          .select('connection_id')
          .eq('provider', 'calendar')
          .contains('metadata', { clerk_user_id: userId })
          .maybeSingle();

    const metaId = (meta as { connection_id?: string } | null)?.connection_id;
    const connectionId = directId || metaId;
    if (!connectionId) {
      return NextResponse.json({ error: 'Calendar not connected' }, { status: 400 });
    }

    const nango = new Nango({ secretKey: nangoSecretKey });

    // Create event in Google Calendar via Nango proxy
    const createRes = await nango.proxy({
      connectionId: String(connectionId),
      providerConfigKey: 'google-calendar',
      method: 'POST',
      endpoint: '/calendar/v3/calendars/primary/events',
      data: {
        summary: body.title,
        description: body.description,
        location: body.location,
        start: { dateTime: body.start_time },
        end: { dateTime: body.end_time },
      },
    });

    const created = createRes.data as { id?: string };
    if (!created?.id) {
      return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
    }

    // Nightfall DLP gate before storage (store tokenized fields; do NOT affect Google event)
    const scanned = await scanContent(`${body.title}\n${body.description || ''}\n${body.location || ''}`);
    await upsertPiiVaultTokens({ userId, tokenToValue: scanned.tokenToValue });
    const [titleLine, descLine, ...rest] = scanned.redacted.split('\n');
    const redactedTitle = titleLine || body.title;
    const redactedDescription = descLine || body.description;
    const redactedLocation = rest.join('\n').trim() || body.location;

    // Persist to Supabase for UI
    const { error: upsertError } = await supa.from('calendar_events').upsert(
      {
        user_id: userId,
        event_id: created.id,
        calendar_id: 'primary',
        title: redactedTitle,
        description: redactedDescription,
        start_time: body.start_time,
        end_time: body.end_time,
        location: redactedLocation,
        attendees: [],
        is_all_day: false,
        status: 'confirmed',
        has_conflict: false,
        conflict_with: [],
      },
      { onConflict: 'user_id,event_id' }
    );

    if (upsertError) {
      console.error('Failed to upsert calendar event', upsertError);
    }

    // CRITICAL: Regenerate briefing after event creation
    // Calendar data changed, so briefing should reflect the new event
    try {
      console.log('[Calendar Event Create] Triggering briefing regeneration');
      await generateBriefingForUser({ userId });
      console.log('[Calendar Event Create] Briefing regenerated successfully');
    } catch (briefingError) {
      console.error('[Calendar Event Create] Briefing regeneration failed:', briefingError);
      // Don't fail the request - event was created successfully
    }

    return NextResponse.json({ success: true, eventId: created.id, briefingRegenerated: true });
  } catch (error) {
    console.error('Error creating calendar event', error);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
