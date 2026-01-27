/**
 * EmergentOS - Onboarding Reflection API
 * 
 * POST /api/onboarding/reflect
 * Generates an AI-powered personalized reflection based on user's answer.
 */

import { auth } from '@clerk/nextjs/server';
import { callGeminiText, isGeminiConfigured } from '@/lib/llm/gemini';
import { buildReflectionPrompt } from '@/lib/llm/prompts';

interface ReflectRequest {
  question: string;
  answer: string;
  stepContext: string;
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isGeminiConfigured()) {
      return Response.json({ 
        error: 'AI service not configured',
        fallback: true 
      }, { status: 503 });
    }

    const body = await request.json().catch(() => ({})) as ReflectRequest;
    const { question, answer, stepContext } = body;

    if (!question || !answer) {
      return Response.json({ 
        error: 'Question and answer are required' 
      }, { status: 400 });
    }

    // Generate AI reflection
    const prompt = buildReflectionPrompt(question, answer, stepContext || 'general');
    const reflection = await callGeminiText(prompt);

    // Clean up the response
    const cleanReflection = reflection
      .trim()
      .replace(/^["']|["']$/g, '') // Remove surrounding quotes if any
      .replace(/—/g, ','); // Replace any em-dashes that slipped through

    return Response.json({
      reflection: cleanReflection,
      success: true,
    });
  } catch (error) {
    console.error('[Onboarding Reflect] Error:', error);
    return Response.json({ 
      error: 'Failed to generate reflection',
      fallback: true 
    }, { status: 500 });
  }
}
