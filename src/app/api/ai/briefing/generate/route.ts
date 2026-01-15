import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { inngest } from '@/lib/inngest';
import { generateBriefingForUser } from '@/lib/briefing-generator';

function isNonRetryableConfigError(message: string): boolean {
  return (
    message.startsWith('Missing ') ||
    message.includes('must decode to 32 bytes') ||
    message.includes('Nightfall scan failed') ||
    message.includes('Missing GEMINI_API_KEY') ||
    message.includes('Missing NIGHTFALL_API_KEY') ||
    message.includes('Missing PII_VAULT_KEY_BASE64')
  );
}

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const date = new Date().toISOString().slice(0, 10);

  // For manual refresh, generate directly so the user sees results immediately.
  // If generation fails (env not set, provider not connected, etc.), fall back to enqueuing.
  try {
    await generateBriefingForUser({ userId, date });
    return NextResponse.json({ success: true, queued: false, mode: 'direct', date });
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown error';
    console.error('Direct briefing generation failed', error);

    // If this is a configuration/schema error, queueing won't help. Fail loudly.
    if (isNonRetryableConfigError(details)) {
      return NextResponse.json(
        { success: false, error: details, mode: 'direct_failed', date },
        { status: 500 }
      );
    }

    // Otherwise, queue as a best-effort fallback (Inngest retries).
    await inngest.send({
      name: 'briefing/generate.requested',
      data: { userId, date, timestamp: new Date().toISOString() },
    });
    return NextResponse.json({
      success: false,
      queued: true,
      mode: 'queued',
      date,
      error: `Briefing was queued because direct generation failed: ${details}`,
    });
  }

  // unreachable
}

