/**
 * EmergentOS - Onboarding Status API
 * 
 * GET /api/onboarding/status
 * Returns the user's current onboarding status and saved progress.
 */

import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import type { OnboardingStatusResponse } from '@/lib/onboarding/types';

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get or create user profile using the database function
    const { data: profile, error } = await supabase
      .rpc('get_or_create_user_profile', { p_user_id: userId });

    if (error) {
      console.error('[Onboarding Status] Database error:', error);
      throw error;
    }

    const response: OnboardingStatusResponse = {
      status: profile.onboarding_status,
      hasProfile: true,
      currentStep: profile.current_step,
      displayName: profile.display_name,
      themeColor: profile.theme_color || 'teal',
      answers: profile.onboarding_answers || {},
    };

    return Response.json(response);
  } catch (error) {
    console.error('[Onboarding Status] Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
