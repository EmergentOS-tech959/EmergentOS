/**
 * EmergentOS - Onboarding Complete API
 * 
 * POST /api/onboarding/complete
 * Finalizes onboarding, generates AI assessment, and stores everything.
 */

import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { callGeminiJSON, isGeminiConfigured } from '@/lib/llm/gemini';
import { buildUserAssessmentPrompt } from '@/lib/llm/prompts';
import type { OnboardingAnswers, UserAssessment, ThemeColor } from '@/lib/onboarding/types';

interface CompleteRequest {
  answers: OnboardingAnswers;
  confirmedRecap: string;
  displayName?: string;
  themeColor?: ThemeColor;
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isGeminiConfigured()) {
      return Response.json({ error: 'AI service not configured' }, { status: 503 });
    }

    const body = await request.json().catch(() => ({})) as CompleteRequest;
    const { answers, confirmedRecap, displayName, themeColor } = body;

    if (!answers || !confirmedRecap) {
      return Response.json({ 
        error: 'Answers and confirmed recap are required' 
      }, { status: 400 });
    }

    // Generate AI assessment
    const prompt = buildUserAssessmentPrompt(answers, confirmedRecap);
    const assessmentText = await callGeminiJSON(prompt);
    
    let assessment: UserAssessment;
    try {
      // Clean up the response and parse
      const cleanText = assessmentText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      
      assessment = JSON.parse(cleanText);
      assessment.generatedAt = new Date().toISOString();
    } catch (parseError) {
      console.warn('[Onboarding Complete] Failed to parse assessment, using fallback:', parseError);
      
      // Fallback assessment if parsing fails
      assessment = {
        generatedAt: new Date().toISOString(),
        profileSummary: confirmedRecap,
        workStyle: {
          decisionApproach: 'analytical',
          energyPattern: 'morning_peak',
          collaborationStyle: 'mixed',
        },
        priorities: [answers.immediate || 'Optimize workflow'],
        suggestedFocus: ['Optimize your workflow based on your preferences'],
        personalityInsights: {
          driverTraits: ['focused', 'goal-oriented'],
          stressors: [answers.blockers || 'Distractions'],
          motivators: ['progress', 'achievement'],
        },
      };
    }

    // Save to database
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        user_id: userId,
        display_name: displayName || null,
        onboarding_status: 'completed',
        current_step: null,
        onboarding_completed_at: now,
        onboarding_answers: answers,
        ai_assessment: assessment,
        theme_color: themeColor || 'teal',
        updated_at: now,
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('[Onboarding Complete] Database error:', error);
      throw error;
    }

    return Response.json({
      success: true,
      assessment,
      message: 'Welcome to EmergentOS! Your system is now personalized.',
    });
  } catch (error) {
    console.error('[Onboarding Complete] Error:', error);
    return Response.json({ error: 'Failed to complete onboarding' }, { status: 500 });
  }
}
