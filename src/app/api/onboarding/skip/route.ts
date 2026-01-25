/**
 * EmergentOS - Onboarding Skip API
 * 
 * POST /api/onboarding/skip
 * Marks onboarding as skipped. User can complete it later from Settings.
 */

import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';

export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date().toISOString();
    
    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        user_id: userId,
        onboarding_status: 'skipped',
        onboarding_skipped_at: now,
        updated_at: now,
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('[Onboarding Skip] Database error:', error);
      throw error;
    }

    return Response.json({
      success: true,
      message: 'Onboarding skipped. You can complete it anytime from Settings.',
    });
  } catch (error) {
    console.error('[Onboarding Skip] Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
