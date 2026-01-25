/**
 * EmergentOS - Onboarding Recap API
 * 
 * POST /api/onboarding/recap
 * Generates an AI-powered Smart Recap based on user answers.
 */

import { auth } from '@clerk/nextjs/server';
import { callGeminiText, isGeminiConfigured } from '@/lib/llm/gemini';
import { buildSmartRecapPrompt } from '@/lib/llm/prompts';
import type { OnboardingAnswers } from '@/lib/onboarding/types';

interface RecapRequest {
  answers: OnboardingAnswers;
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

    const body = await request.json().catch(() => ({})) as RecapRequest;
    const { answers } = body;

    if (!answers) {
      return Response.json({ error: 'Answers are required' }, { status: 400 });
    }

    // Generate the Smart Recap (plain text, not JSON)
    const prompt = buildSmartRecapPrompt(answers);
    const recap = await callGeminiText(prompt);

    // Clean up the response (remove any markdown code fences if present)
    const cleanRecap = recap
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    return Response.json({ recap: cleanRecap, success: true });
  } catch (error) {
    console.error('[Onboarding Recap] Error:', error);
    return Response.json({ error: 'Failed to generate recap' }, { status: 500 });
  }
}
