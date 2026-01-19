import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { runCalendarAnalysisForUser } from '@/lib/calendar-analysis';

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await runCalendarAnalysisForUser({ userId });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

