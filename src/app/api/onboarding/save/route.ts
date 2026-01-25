/**
 * EmergentOS - Onboarding Save API
 * 
 * POST /api/onboarding/save
 * Saves conversation progress for resume functionality.
 */

import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import type { ConversationStep, ThemeColor, OnboardingAnswers } from '@/lib/onboarding/types';

interface SaveRequest {
  currentStep?: ConversationStep;
  answers?: Partial<OnboardingAnswers>;
  displayName?: string;
  themeColor?: ThemeColor;
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({})) as SaveRequest;
    const { currentStep, answers, displayName, themeColor } = body;

    const now = new Date().toISOString();
    
    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {
      user_id: userId,
      onboarding_status: 'in_progress',
      updated_at: now,
    };

    if (currentStep !== undefined) {
      updateData.current_step = currentStep;
    }
    
    if (answers !== undefined) {
      updateData.onboarding_answers = answers;
    }
    
    if (displayName !== undefined) {
      updateData.display_name = displayName;
    }
    
    if (themeColor !== undefined) {
      updateData.theme_color = themeColor;
    }

    // Set started_at only if not already set
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('onboarding_started_at')
      .eq('user_id', userId)
      .single();

    if (!existingProfile?.onboarding_started_at) {
      updateData.onboarding_started_at = now;
    }

    const { error } = await supabase
      .from('user_profiles')
      .upsert(updateData, { onConflict: 'user_id' });

    if (error) {
      console.error('[Onboarding Save] Database error:', error);
      throw error;
    }

    return Response.json({ success: true, savedAt: now });
  } catch (error) {
    console.error('[Onboarding Save] Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
