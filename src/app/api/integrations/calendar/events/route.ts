import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { Nango } from '@nangohq/node';
import type { SupabaseClient } from '@supabase/supabase-js';

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

  return NextResponse.json({ events: data || [] });
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

    // Persist to Supabase for UI
    const { error: upsertError } = await supa.from('calendar_events').upsert(
      {
        user_id: userId,
        event_id: created.id,
        calendar_id: 'primary',
        title: body.title,
        description: body.description,
        start_time: body.start_time,
        end_time: body.end_time,
        location: body.location,
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

    return NextResponse.json({ success: true, eventId: created.id });
  } catch (error) {
    console.error('Error creating calendar event', error);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
