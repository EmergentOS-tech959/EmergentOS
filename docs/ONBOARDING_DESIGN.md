# EmergentOS Onboarding System - Design Document

**Version:** 6.0 (Final Production)  
**Date:** January 23, 2026  
**Status:** Ready for Implementation

---

## Executive Summary

This document outlines the design for implementing a professional, AI-driven onboarding flow for EmergentOS. The onboarding system captures user preferences, goals, and working styles through a conversational interface, storing the information to personalize the user experience. Users can skip onboarding during initial sign-up and complete it later from Settings.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema](#2-database-schema)
3. [API Routes](#3-api-routes)
4. [LLM Prompts](#4-llm-prompts)
5. [Type Definitions](#5-type-definitions)
6. [Onboarding Script Data](#6-onboarding-script-data)
7. [Dashboard Integration](#7-dashboard-integration)
8. [Settings Integration](#8-settings-integration)
9. [File Structure](#9-file-structure)
10. [Middleware Configuration](#10-middleware-configuration)
11. [CSS Additions](#11-css-additions)
12. [Implementation Phases](#12-implementation-phases)
13. [Risk Mitigation](#13-risk-mitigation)
14. [Success Metrics](#14-success-metrics)

---

## 1. Architecture Overview

### 1.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              ONBOARDING FLOW                                     │
│                                                                                  │
│   ┌──────────────┐    ┌──────────────────┐    ┌──────────────────────────────┐  │
│   │  Sign-Up /   │    │   Onboarding     │    │    AI-Generated              │  │
│   │  First Login │───▶│   Conversation   │───▶│    Smart Recap + Assessment  │  │
│   │              │    │   (Skippable)    │    │    (Stored in DB)            │  │
│   └──────────────┘    └──────────────────┘    └──────────────────────────────┘  │
│         │                     ▲                                                  │
│         │ Skip                │ Resume                                           │
│         ▼                     │                                                  │
│   ┌──────────────┐    ┌──────────────────┐                                      │
│   │  Dashboard   │    │    Settings      │                                      │
│   │  (Redirect   │───▶│    "Complete     │                                      │
│   │   if pending)│    │     Onboarding"  │                                      │
│   └──────────────┘    └──────────────────┘                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                            │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  /app/onboarding/page.tsx               - Full-screen onboarding page     │  │
│  │  /app/onboarding/layout.tsx             - Minimal layout (no AppShell)    │  │
│  │  /components/onboarding/                                                   │  │
│  │    ├── onboarding-provider.tsx          - Context for onboarding state    │  │
│  │    ├── onboarding-flow.tsx              - Main conversation orchestrator  │  │
│  │    ├── onboarding-message.tsx           - Chat message bubble component   │  │
│  │    ├── onboarding-input.tsx             - User input component            │  │
│  │    ├── onboarding-progress.tsx          - Visual progress indicator       │  │
│  │    ├── onboarding-core.tsx              - Animated AI orb component       │  │
│  │    ├── onboarding-recap.tsx             - Smart recap display             │  │
│  │    ├── onboarding-complete.tsx          - Completion celebration screen   │  │
│  │    └── theme-selector.tsx               - Theme color picker              │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                       │                                          │
│                                       │ HTTPS                                    │
│                                       ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                      API ROUTES                                            │  │
│  │  /api/onboarding/status            GET  - Check onboarding status          │  │
│  │  /api/onboarding/skip              POST - Mark onboarding as skipped       │  │
│  │  /api/onboarding/save              POST - Save progress during conversation│  │
│  │  /api/onboarding/chat              POST - Stream AI conversation (SSE)     │  │
│  │  /api/onboarding/recap             POST - Generate smart recap             │  │
│  │  /api/onboarding/complete          POST - Store assessment & complete      │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DATABASE (Supabase)                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  user_profiles                                                             │  │
│  │    ├── id UUID PRIMARY KEY DEFAULT gen_random_uuid()                      │  │
│  │    ├── user_id TEXT NOT NULL UNIQUE (Clerk ID)                            │  │
│  │    ├── display_name TEXT                                                  │  │
│  │    ├── onboarding_status TEXT DEFAULT 'pending'                           │  │
│  │    ├── current_step TEXT (for resume)                                     │  │
│  │    ├── onboarding_answers JSONB DEFAULT '{}'                              │  │
│  │    ├── ai_assessment JSONB DEFAULT '{}'                                   │  │
│  │    ├── preferences JSONB DEFAULT '{}'                                     │  │
│  │    ├── theme_color TEXT DEFAULT 'teal'                                    │  │
│  │    ├── created_at TIMESTAMPTZ DEFAULT now()                               │  │
│  │    └── updated_at TIMESTAMPTZ DEFAULT now()                               │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database Schema

### 2.1 New Table: `user_profiles`

**Migration File:** `supabase/migrations/002_user_profiles.sql`

```sql
-- ============================================================================
-- user_profiles - User preferences and onboarding data
-- Migration: 002_user_profiles.sql
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,                   -- Clerk user ID
  display_name TEXT,                              -- User's preferred name
  
  -- Onboarding State
  onboarding_status TEXT NOT NULL DEFAULT 'pending',
  current_step TEXT,                              -- For resume: focus|decisions|etc.
  onboarding_started_at TIMESTAMPTZ,
  onboarding_completed_at TIMESTAMPTZ,
  onboarding_skipped_at TIMESTAMPTZ,
  
  -- User Answers (Raw from conversation)
  onboarding_answers JSONB DEFAULT '{}',
  
  -- AI-Generated Assessment (created on completion)
  ai_assessment JSONB DEFAULT '{}',
  
  -- User Preferences
  preferences JSONB DEFAULT '{}',
  theme_color TEXT DEFAULT 'teal',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT user_profiles_status_check CHECK (
    onboarding_status IN ('pending', 'in_progress', 'skipped', 'completed')
  ),
  CONSTRAINT user_profiles_theme_check CHECK (
    theme_color IN ('teal', 'purple', 'orange', 'pink', 'blue')
  ),
  CONSTRAINT user_profiles_step_check CHECK (
    current_step IS NULL OR current_step IN (
      'focus', 'decisions', 'flow', 'blockers', 'immediate', 'context1', 'context2'
    )
  )
);

-- Note: No index on user_id needed - UNIQUE constraint creates implicit index
CREATE INDEX IF NOT EXISTS idx_user_profiles_status ON user_profiles (onboarding_status);

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Function to get or create user profile
CREATE OR REPLACE FUNCTION get_or_create_user_profile(p_user_id TEXT)
RETURNS user_profiles
LANGUAGE plpgsql
AS $$
DECLARE
  result user_profiles;
BEGIN
  SELECT * INTO result FROM user_profiles WHERE user_id = p_user_id;
  
  IF NOT FOUND THEN
    INSERT INTO user_profiles (user_id) 
    VALUES (p_user_id)
    RETURNING * INTO result;
  END IF;
  
  RETURN result;
END;
$$;
```

### 2.2 JSONB Schema: `onboarding_answers`

```json
{
  "focus": "Building a startup in AI/ML space",
  "decisions": "Data-driven, gather input before deciding",
  "flow": "Deep work in morning, quiet environment",
  "blockers": "Too many meetings, context switching",
  "immediate": "Better calendar management",
  "context1": {
    "question": "What tends to bring you back when distracted?",
    "answer": "Taking a short walk, reviewing my priorities"
  },
  "context2": {
    "question": "Are there decisions you'd like streamlined?",
    "answer": "Email triage, meeting scheduling"
  }
}
```

### 2.3 JSONB Schema: `ai_assessment`

```json
{
  "generatedAt": "2026-01-23T10:30:00Z",
  "profileSummary": "A focused entrepreneur building in AI/ML who values deep work and data-driven decisions. Struggles with meeting overload and context-switching, seeking better calendar management and email triage support.",
  "workStyle": {
    "decisionApproach": "analytical",
    "energyPattern": "morning_peak",
    "collaborationStyle": "async_preferred"
  },
  "priorities": [
    "Calendar optimization",
    "Email management",
    "Focus time protection"
  ],
  "suggestedFocus": [
    "Block morning hours for deep work",
    "Batch email reviews to 2x daily",
    "Automate meeting preparation"
  ],
  "personalityInsights": {
    "driverTraits": ["achievement", "efficiency", "innovation"],
    "stressors": ["interruptions", "unclear priorities"],
    "motivators": ["progress", "impact", "learning"]
  }
}
```

---

## 3. API Routes

### 3.1 GET `/api/onboarding/status`

Returns the user's current onboarding status.

**Response (200):**
```json
{
  "status": "pending",
  "hasProfile": true,
  "currentStep": null,
  "displayName": null,
  "themeColor": "teal",
  "answers": {}
}
```

**Response (401):**
```json
{
  "error": "Unauthorized"
}
```

**Implementation:**
```typescript
// src/app/api/onboarding/status/route.ts
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get or create profile
    const { data: profile, error } = await supabase
      .rpc('get_or_create_user_profile', { p_user_id: userId });

    if (error) throw error;

    return Response.json({
      status: profile.onboarding_status,
      hasProfile: true,
      currentStep: profile.current_step,
      displayName: profile.display_name,
      themeColor: profile.theme_color,
      answers: profile.onboarding_answers || {},
    });
  } catch (error) {
    console.error('[Onboarding Status] Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### 3.2 POST `/api/onboarding/skip`

Marks onboarding as skipped (can be completed later).

**Response (200):**
```json
{
  "success": true,
  "message": "Onboarding skipped. You can complete it anytime from Settings."
}
```

**Implementation:**
```typescript
// src/app/api/onboarding/skip/route.ts
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';

export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        user_id: userId,
        onboarding_status: 'skipped',
        onboarding_skipped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) throw error;

    return Response.json({
      success: true,
      message: 'Onboarding skipped. You can complete it anytime from Settings.',
    });
  } catch (error) {
    console.error('[Onboarding Skip] Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### 3.3 POST `/api/onboarding/save`

Saves conversation progress for resume functionality.

**Request:**
```json
{
  "currentStep": "decisions",
  "answers": {
    "focus": "Building a startup in AI/ML space"
  },
  "displayName": "John",
  "themeColor": "teal"
}
```

**Response (200):**
```json
{
  "success": true,
  "savedAt": "2026-01-23T10:30:00Z"
}
```

**Implementation:**
```typescript
// src/app/api/onboarding/save/route.ts
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { currentStep, answers, displayName, themeColor } = body;

    const now = new Date().toISOString();
    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        user_id: userId,
        onboarding_status: 'in_progress',
        current_step: currentStep || null,
        onboarding_answers: answers || {},
        display_name: displayName || null,
        theme_color: themeColor || 'teal',
        onboarding_started_at: now,
        updated_at: now,
      }, { onConflict: 'user_id' });

    if (error) throw error;

    return Response.json({ success: true, savedAt: now });
  } catch (error) {
    console.error('[Onboarding Save] Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### 3.4 POST `/api/onboarding/chat`

Handles streaming AI conversation for onboarding via Server-Sent Events.

**Request:**
```json
{
  "message": "User's response text",
  "currentStep": "focus",
  "previousAnswers": {}
}
```

**Response:** Server-Sent Events stream

```
data: {"text":"Got it — "}

data: {"text":"sounds like that's a top priority for you."}

data: {"text":"\n\nNext — how do you usually make decisions?"}

data: {"nextStep":"decisions"}

data: [DONE]
```

**Implementation:**
```typescript
// src/app/api/onboarding/chat/route.ts
import { auth } from '@clerk/nextjs/server';
import { isGeminiConfigured } from '@/lib/llm/gemini';
import { buildOnboardingConversationPrompt } from '@/lib/llm/prompts';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLM_MODEL } from '@/lib/constants';
import { getNextStep, selectDynamicQuestions } from '@/lib/onboarding/script';
import type { ConversationStep } from '@/lib/onboarding/types';

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isGeminiConfigured()) {
      return Response.json({ error: 'Gemini API not configured' }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const { message, currentStep, previousAnswers } = body;

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'Message is required' }, { status: 400 });
    }

    // Get dynamic questions for context steps
    let dynamicQuestions: { q1?: string; q2?: string } | undefined;
    if (currentStep === 'context1' || currentStep === 'context2') {
      const selected = selectDynamicQuestions(previousAnswers || {});
      dynamicQuestions = {
        q1: selected.q1.question,
        q2: selected.q2.question,
      };
    }

    // Build prompt
    const prompt = buildOnboardingConversationPrompt(
      currentStep as ConversationStep,
      previousAnswers || {},
      message,
      dynamicQuestions
    );

    // Call Gemini with streaming
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: LLM_MODEL });

    const result = await model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 1024,
      },
    });

    // Create SSE stream
    const encoder = new TextEncoder();
    const nextStep = getNextStep(currentStep as ConversationStep);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
            }
          }
          
          // Send next step info
          if (nextStep) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ nextStep })}\n\n`));
          }
          
          // Send completion signal
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[Onboarding Chat] Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### 3.5 POST `/api/onboarding/recap`

Generates AI-powered smart recap based on user answers.

**Request:**
```json
{
  "answers": {
    "focus": "Building a startup in AI/ML space",
    "decisions": "Data-driven approach",
    "flow": "Morning deep work",
    "blockers": "Too many meetings",
    "immediate": "Calendar optimization",
    "context1": {
      "question": "What tends to bring you back when distracted?",
      "answer": "Taking a walk"
    },
    "context2": {
      "question": "Are there decisions you'd like streamlined?",
      "answer": "Email triage"
    }
  }
}
```

**Response (200):**
```json
{
  "recap": "You're focused on building a startup in the AI/ML space, and it's clear this is a top priority for you right now. When it comes to decisions, you take a data-driven approach, gathering input before committing. You feel most in flow during morning deep work sessions, and the main thing that tends to derail you is too many meetings. Right now, the most helpful thing I can do is help with calendar optimization.\n\nDoes that sound about right?",
  "success": true
}
```

**Implementation:**
```typescript
// src/app/api/onboarding/recap/route.ts
import { auth } from '@clerk/nextjs/server';
import { callGeminiJSON, isGeminiConfigured } from '@/lib/llm/gemini';
import { buildSmartRecapPrompt } from '@/lib/llm/prompts';
import type { OnboardingAnswers } from '@/lib/onboarding/types';

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isGeminiConfigured()) {
      return Response.json({ error: 'Gemini API not configured' }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const { answers } = body as { answers: OnboardingAnswers };

    if (!answers) {
      return Response.json({ error: 'Answers are required' }, { status: 400 });
    }

    const prompt = buildSmartRecapPrompt(answers);
    const recap = await callGeminiJSON(prompt);

    return Response.json({ recap, success: true });
  } catch (error) {
    console.error('[Onboarding Recap] Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### 3.6 POST `/api/onboarding/complete`

Finalizes onboarding, generates AI assessment, and stores everything.

**Request:**
```json
{
  "answers": {
    "focus": "Building a startup in AI/ML space",
    "decisions": "Data-driven approach",
    "flow": "Morning deep work",
    "blockers": "Too many meetings",
    "immediate": "Calendar optimization",
    "context1": {
      "question": "What tends to bring you back when distracted?",
      "answer": "Taking a walk"
    },
    "context2": {
      "question": "Are there decisions you'd like streamlined?",
      "answer": "Email triage"
    }
  },
  "confirmedRecap": "You're focused on building a startup...",
  "displayName": "John",
  "themeColor": "teal"
}
```

**Response (200):**
```json
{
  "success": true,
  "assessment": {
    "generatedAt": "2026-01-23T10:30:00Z",
    "profileSummary": "A focused entrepreneur...",
    "workStyle": {
      "decisionApproach": "analytical",
      "energyPattern": "morning_peak",
      "collaborationStyle": "async_preferred"
    },
    "priorities": ["Calendar optimization", "Email management", "Focus time protection"],
    "suggestedFocus": ["Block morning hours for deep work", "Batch email reviews to 2x daily"],
    "personalityInsights": {
      "driverTraits": ["achievement", "efficiency"],
      "stressors": ["interruptions"],
      "motivators": ["progress", "impact"]
    }
  },
  "message": "Welcome to EmergentOS! Your system is now personalized."
}
```

**Implementation:**
```typescript
// src/app/api/onboarding/complete/route.ts
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { callGeminiJSON, isGeminiConfigured } from '@/lib/llm/gemini';
import { buildUserAssessmentPrompt } from '@/lib/llm/prompts';
import type { OnboardingAnswers, UserAssessment } from '@/lib/onboarding/types';

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isGeminiConfigured()) {
      return Response.json({ error: 'Gemini API not configured' }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const { answers, confirmedRecap, displayName, themeColor } = body as {
      answers: OnboardingAnswers;
      confirmedRecap: string;
      displayName?: string;
      themeColor?: string;
    };

    if (!answers || !confirmedRecap) {
      return Response.json({ error: 'Answers and confirmed recap are required' }, { status: 400 });
    }

    // Generate AI assessment
    const prompt = buildUserAssessmentPrompt(answers, confirmedRecap);
    const assessmentText = await callGeminiJSON(prompt);
    
    let assessment: UserAssessment;
    try {
      assessment = JSON.parse(assessmentText);
      assessment.generatedAt = new Date().toISOString();
    } catch {
      // Fallback assessment if parsing fails
      assessment = {
        generatedAt: new Date().toISOString(),
        profileSummary: confirmedRecap,
        workStyle: {
          decisionApproach: 'analytical',
          energyPattern: 'morning_peak',
          collaborationStyle: 'mixed',
        },
        priorities: [answers.immediate],
        suggestedFocus: ['Optimize your workflow based on your preferences'],
        personalityInsights: {
          driverTraits: ['focused'],
          stressors: [answers.blockers],
          motivators: ['progress'],
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

    if (error) throw error;

    return Response.json({
      success: true,
      assessment,
      message: 'Welcome to EmergentOS! Your system is now personalized.',
    });
  } catch (error) {
    console.error('[Onboarding Complete] Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

---

## 4. LLM Prompts

### 4.1 Type Definitions for Prompts

Add to `src/lib/llm/prompts.ts`:

```typescript
export type ConversationStep = 
  | 'focus'
  | 'decisions'
  | 'flow'
  | 'blockers'
  | 'immediate'
  | 'context1'
  | 'context2';

export interface OnboardingAnswers {
  focus: string;
  decisions: string;
  flow: string;
  blockers: string;
  immediate: string;
  context1?: {
    question: string;
    answer: string;
  };
  context2?: {
    question: string;
    answer: string;
  };
}
```

### 4.2 Onboarding Conversation Prompt

```typescript
export function buildOnboardingConversationPrompt(
  currentStep: ConversationStep,
  previousAnswers: Record<string, string>,
  userMessage: string,
  dynamicQuestions?: { q1?: string; q2?: string }
): string {
  return `You are the EmergentOS onboarding assistant. Your role is to warmly guide users through initial profiling questions.

## PERSONA
- Tone: Friendly guide × Strategic productivity coach
- Style: Warm but professional, curious but not intrusive
- Brevity: Keep responses concise (1-2 sentences for reflection, then ask next question)

## CURRENT CONTEXT
- Step: ${currentStep}
- Previous Answers: ${JSON.stringify(previousAnswers)}
- User Just Said: "${userMessage}"

## YOUR TASK
1. Acknowledge their response with a brief, thoughtful reflection (1-2 sentences max)
2. Naturally transition to the next question

## CONVERSATION FLOW
Step focus: "First up — what's something you're currently working toward that really matters to you?"
Step decisions: "How do you usually make decisions? More instinctively, or after gathering lots of input?"
Step flow: "When do you feel most in flow — like you're at your best?"
Step blockers: "What's something that often slows you down or knocks you off-track?"
Step immediate: "If I could help with just one thing right now, what would it be?"
${dynamicQuestions?.q1 ? `Step context1: "${dynamicQuestions.q1}"` : ''}
${dynamicQuestions?.q2 ? `Step context2: "${dynamicQuestions.q2}"` : ''}

## REFLECTION EXAMPLES
- "Got it — sounds like that's a top priority for you."
- "That gives me a clear sense of what's driving you."
- "Helpful — I'll lean into that style."
- "Great — I'll keep that in mind."
- "Noted — I'll help you stay ahead of that."
- "Perfect — I'll start there."

## RULES
- Never repeat the question they just answered
- Keep reflections genuine and specific to what they shared
- After reflection, ask the NEXT question in the flow
- Do NOT include step labels or formatting in your response
- If this is step context2, end with your reflection only (no next question)

Respond with ONLY your natural conversational reply.`;
}
```

### 4.3 Smart Recap Generation Prompt

```typescript
export function buildSmartRecapPrompt(answers: OnboardingAnswers): string {
  return `You are generating a professional Smart Recap for EmergentOS onboarding.

## USER'S ANSWERS
${JSON.stringify(answers, null, 2)}

## YOUR TASK
Create a warm, professional summary that:
1. Synthesizes their responses into a cohesive narrative
2. Shows genuine understanding of their situation
3. Highlights the key themes and priorities
4. Feels personalized, not template-like

## FORMAT
Write a 2-3 paragraph recap in second person ("You're focused on...", "You tend to...").
Make it feel like a thoughtful observation from someone who listened carefully.
End with the question: "Does that sound about right?"

## EXAMPLE STRUCTURE
"You're focused on [their goal], and it's clear this is a top priority for you right now. When it comes to decisions, you [their style], which tells me [insight]. You feel most in flow when [their trigger], and the main thing that tends to derail you is [their blocker]. Right now, the most helpful thing I can do is [their immediate need].

[Add insight from context questions if present]

Does that sound about right?"

Respond with ONLY the recap text. No JSON, no markdown formatting.`;
}
```

### 4.4 User Assessment Generation Prompt

```typescript
export function buildUserAssessmentPrompt(
  answers: OnboardingAnswers,
  confirmedRecap: string
): string {
  return `You are an executive profiling system for EmergentOS. Based on the user's onboarding responses, generate a comprehensive assessment.

## USER'S RESPONSES
${JSON.stringify(answers, null, 2)}

## RECAP CONFIRMED BY USER
${confirmedRecap}

## YOUR TASK
Generate a detailed JSON assessment that will be used to personalize their EmergentOS experience.

Respond with ONLY valid JSON in this exact format (no markdown code fences):
{
  "profileSummary": "A 2-3 sentence executive summary of this user's profile",
  "workStyle": {
    "decisionApproach": "analytical" | "intuitive" | "collaborative" | "deliberate",
    "energyPattern": "morning_peak" | "afternoon_peak" | "evening_peak" | "steady",
    "collaborationStyle": "async_preferred" | "sync_preferred" | "mixed"
  },
  "priorities": ["Top 3-5 priorities based on their responses"],
  "suggestedFocus": ["3-5 specific recommendations for how EmergentOS can help"],
  "personalityInsights": {
    "driverTraits": ["2-3 key motivating traits"],
    "stressors": ["2-3 things that cause friction"],
    "motivators": ["2-3 things that energize them"]
  }
}`;
}
```

---

## 5. Type Definitions

### 5.1 Complete Type Definitions

**File:** `src/lib/onboarding/types.ts`

```typescript
/**
 * Conversation step identifiers (matches database current_step)
 */
export type ConversationStep = 
  | 'focus'
  | 'decisions'
  | 'flow'
  | 'blockers'
  | 'immediate'
  | 'context1'
  | 'context2';

/**
 * UI phase for onboarding flow (frontend only)
 */
export type OnboardingPhase = 
  | 'intro'
  | 'conversation'
  | 'recap'
  | 'complete';

/**
 * Database onboarding status
 */
export type OnboardingStatus = 
  | 'pending'
  | 'in_progress'
  | 'skipped'
  | 'completed';

/**
 * Available theme colors (matches database CHECK constraint)
 */
export type ThemeColor = 'teal' | 'purple' | 'orange' | 'pink' | 'blue';

/**
 * Dynamic question configuration
 */
export interface DynamicQuestion {
  id: string;
  question: string;
  triggers: string[];
  priority: number;
}

/**
 * Context question answer structure
 */
export interface ContextAnswer {
  question: string;
  answer: string;
}

/**
 * Complete onboarding answers structure
 */
export interface OnboardingAnswers {
  focus: string;
  decisions: string;
  flow: string;
  blockers: string;
  immediate: string;
  context1?: ContextAnswer;
  context2?: ContextAnswer;
}

/**
 * Chat message in onboarding conversation
 */
export interface OnboardingMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * Work style assessment
 */
export interface WorkStyle {
  decisionApproach: 'analytical' | 'intuitive' | 'collaborative' | 'deliberate';
  energyPattern: 'morning_peak' | 'afternoon_peak' | 'evening_peak' | 'steady';
  collaborationStyle: 'async_preferred' | 'sync_preferred' | 'mixed';
}

/**
 * Personality insights
 */
export interface PersonalityInsights {
  driverTraits: string[];
  stressors: string[];
  motivators: string[];
}

/**
 * Complete AI-generated assessment
 */
export interface UserAssessment {
  generatedAt: string;
  profileSummary: string;
  workStyle: WorkStyle;
  priorities: string[];
  suggestedFocus: string[];
  personalityInsights: PersonalityInsights;
}

/**
 * User profile from database
 */
export interface UserProfile {
  id: string;
  user_id: string;
  display_name: string | null;
  onboarding_status: OnboardingStatus;
  current_step: ConversationStep | null;
  onboarding_started_at: string | null;
  onboarding_completed_at: string | null;
  onboarding_skipped_at: string | null;
  onboarding_answers: OnboardingAnswers | Record<string, never>;
  ai_assessment: UserAssessment | Record<string, never>;
  preferences: Record<string, unknown>;
  theme_color: ThemeColor;
  created_at: string;
  updated_at: string;
}

/**
 * Onboarding status API response
 */
export interface OnboardingStatusResponse {
  status: OnboardingStatus;
  hasProfile: boolean;
  currentStep: ConversationStep | null;
  displayName: string | null;
  themeColor: ThemeColor;
  answers?: Partial<OnboardingAnswers>;
}
```

### 5.2 Export from Types Index

Add to `src/types/index.ts`:

```typescript
// Onboarding types
export type {
  ConversationStep,
  OnboardingPhase,
  OnboardingStatus,
  ThemeColor,
  DynamicQuestion,
  ContextAnswer,
  OnboardingAnswers,
  OnboardingMessage,
  WorkStyle,
  PersonalityInsights,
  UserAssessment,
  UserProfile,
  OnboardingStatusResponse,
} from '@/lib/onboarding/types';
```

---

## 6. Onboarding Script Data

**File:** `src/lib/onboarding/script.ts`

```typescript
import type { ConversationStep, DynamicQuestion } from './types';

export const ONBOARDING_SCRIPT = {
  intro: {
    greeting: "Hello, and welcome to EmergentOS — your personal operating system.",
    followUp: "I'm here to ask you a few quick questions to personalise your experience. You can speak or type — whatever feels easiest for you.",
    primers: [
      "This won't take long — the more you share, the more helpful I can be.",
      "We'll keep things light — just enough to understand what matters to you.",
      "Think of this as setting the foundations so I can support you properly."
    ]
  },
  
  steps: {
    focus: {
      section: 1,
      sectionTitle: "Where You're At + What Drives You",
      sectionIntro: "Let's start with where you're at, and what's important to you right now.",
      question: "First up — what's something you're currently working toward that really matters to you?",
      hint: "This helps me understand what you're optimising for.",
      reflections: [
        "Got it — sounds like that's a top priority for you.",
        "That gives me a clear sense of what's driving you."
      ]
    },
    decisions: {
      section: 1,
      question: "Next — how do you usually make decisions? More instinctively, or after gathering lots of input?",
      hint: "This guides how I present options and recommendations.",
      reflections: [
        "Helpful — I'll lean into that style.",
        "Good to know — that shapes how I support you."
      ]
    },
    flow: {
      section: 1,
      question: "When do you feel most in flow — like you're at your best?",
      hint: "This helps me match your natural rhythm.",
      reflections: [
        "Great — I'll keep that in mind.",
        "Flow triggers are incredibly powerful — thank you."
      ]
    },
    blockers: {
      section: 2,
      sectionTitle: "Friction + Support",
      sectionIntro: "Now let's look at what gets in your way — and where I can help most.",
      question: "What's something that often slows you down or knocks you off-track?",
      hint: "This helps me anticipate friction before it builds.",
      reflections: [
        "Noted — I'll help you stay ahead of that.",
        "That's really useful."
      ]
    },
    immediate: {
      section: 2,
      question: "If I could help with just one thing right now, what would it be?",
      hint: "This shows me where to focus first.",
      reflections: [
        "Perfect — I'll start there.",
        "Got it — I'll keep that front and centre."
      ]
    },
    context1: {
      section: 3,
      sectionTitle: "Context Expansion",
      sectionIntro: "Great — just two quick questions to round things out.",
      isDynamic: true,
      reflections: [
        "Thanks — that rounds things out nicely.",
        "Good to know — that helps complete the picture."
      ]
    },
    context2: {
      section: 3,
      isDynamic: true,
      reflections: [
        "Thanks — that rounds things out nicely.",
        "Good to know — that helps complete the picture."
      ]
    }
  } as Record<ConversationStep, {
    section: number;
    sectionTitle?: string;
    sectionIntro?: string;
    question?: string;
    hint?: string;
    isDynamic?: boolean;
    reflections: string[];
  }>,
  
  dynamicQuestions: [
    {
      id: "launch",
      triggers: ["launch", "milestone", "deadline", "goal", "ship", "release"],
      question: "What would make you feel 100% ready for that launch or milestone?",
      priority: 1
    },
    {
      id: "stress",
      triggers: ["overwhelm", "stress", "distract", "overload", "anxious", "busy"],
      question: "What tends to bring you back when you're feeling distracted or overloaded?",
      priority: 2
    },
    {
      id: "decisions",
      triggers: ["decision", "choose", "option", "choice", "uncertain"],
      question: "Are there any decisions you'd like me to streamline or take off your plate?",
      priority: 3
    },
    {
      id: "delayed",
      triggers: ["idea", "project", "backlog", "someday", "postpone", "later"],
      question: "What's one idea or project that keeps getting pushed back?",
      priority: 4
    },
    {
      id: "team",
      triggers: ["team", "collaborate", "timezone", "async", "handoff", "colleague"],
      question: "Would it help if I highlighted patterns or handoffs across your team?",
      priority: 5
    }
  ] as DynamicQuestion[],
  
  wrapUp: {
    thanks: "Thanks — that gives me a strong foundation to start supporting you.",
    completion: "You've now completed Level 1 Profiling inside EmergentOS.",
    closingLines: [
      "From here, your system will start adapting around you.",
      "Everything from this point onwards becomes more personalised and more precise.",
      "The more we talk, the smarter and more helpful I become."
    ],
    final: "And that completes the first step of your onboarding. Now let's get your most-used tools integrated, so I can start supporting you straight away."
  }
};

/**
 * Step progression order
 */
export const STEP_ORDER: ConversationStep[] = [
  'focus',
  'decisions',
  'flow',
  'blockers',
  'immediate',
  'context1',
  'context2'
];

/**
 * Get next step in sequence
 */
export function getNextStep(currentStep: ConversationStep): ConversationStep | null {
  const currentIndex = STEP_ORDER.indexOf(currentStep);
  if (currentIndex === -1 || currentIndex === STEP_ORDER.length - 1) {
    return null;
  }
  return STEP_ORDER[currentIndex + 1];
}

/**
 * Select dynamic questions based on previous answers
 */
export function selectDynamicQuestions(
  answers: Record<string, string>
): { q1: DynamicQuestion; q2: DynamicQuestion } {
  const allText = Object.values(answers).join(' ').toLowerCase();
  
  // Score each question by trigger matches
  const scored = ONBOARDING_SCRIPT.dynamicQuestions.map(q => ({
    question: q,
    score: q.triggers.filter(t => allText.includes(t.toLowerCase())).length
  }));
  
  // Sort by score (desc), then priority (asc)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.question.priority - b.question.priority;
  });
  
  // Return top 2, ensuring we have two unique questions
  const q1 = scored[0]?.question || ONBOARDING_SCRIPT.dynamicQuestions[1];
  const q2 = scored[1]?.question || ONBOARDING_SCRIPT.dynamicQuestions[2];
  
  return { q1, q2 };
}
```

---

## 7. Dashboard Integration

**File:** `src/app/dashboard/layout.tsx`

The dashboard layout must be converted to a client component to handle onboarding redirect:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Check onboarding status
    fetch('/api/onboarding/status')
      .then(res => res.json())
      .then(data => {
        if (data.status === 'pending') {
          router.replace('/onboarding');
        } else {
          setIsReady(true);
        }
      })
      .catch(() => {
        // On error, allow access (fail open)
        setIsReady(true);
      });
  }, [router]);

  // Show loading spinner while checking
  if (!isReady) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
```

---

## 8. Settings Integration

Add the following to `src/app/settings/page.tsx`:

### 8.1 Add Imports

```typescript
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
```

### 8.2 Add State

Inside `SettingsPage` component:

```typescript
const router = useRouter();
const [onboardingStatus, setOnboardingStatus] = useState<string>('pending');

useEffect(() => {
  fetch('/api/onboarding/status')
    .then(res => res.json())
    .then(data => setOnboardingStatus(data.status))
    .catch(() => {});
}, []);
```

### 8.3 Add UI Component

Inside `TabsContent value="account"`, after the Profile section:

```tsx
{/* Onboarding Status */}
<div className="space-y-3 mt-6">
  <h3 className="text-sm font-medium text-foreground">Profile Setup</h3>
  
  {onboardingStatus === 'skipped' && (
    <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/10">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-amber-500" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-medium text-foreground">Complete Your Profile</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Finish onboarding to personalize your EmergentOS experience
          </p>
        </div>
        <Button 
          onClick={() => router.push('/onboarding')}
          className="bg-amber-500 hover:bg-amber-600 text-white"
        >
          Complete Now
        </Button>
      </div>
    </div>
  )}
  
  {onboardingStatus === 'in_progress' && (
    <div className="p-4 rounded-lg border border-sky-500/30 bg-sky-500/10">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-sky-500/20 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-sky-500" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-medium text-foreground">Continue Setup</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            You have an onboarding session in progress
          </p>
        </div>
        <Button 
          onClick={() => router.push('/onboarding')}
          className="bg-sky-500 hover:bg-sky-600 text-white"
        >
          Continue
        </Button>
      </div>
    </div>
  )}
  
  {onboardingStatus === 'completed' && (
    <div className="p-4 rounded-lg border border-border/30 bg-secondary/20">
      <div className="flex items-center gap-2 text-emerald-500 text-sm">
        <CheckCircle2 className="h-4 w-4" />
        <span>Profile setup completed</span>
      </div>
    </div>
  )}
</div>
```

---

## 9. File Structure

```
src/
├── app/
│   ├── onboarding/
│   │   ├── page.tsx              # Main onboarding page
│   │   └── layout.tsx            # Minimal layout (no AppShell)
│   ├── dashboard/
│   │   └── layout.tsx            # Client component with onboarding check
│   └── api/
│       └── onboarding/
│           ├── status/
│           │   └── route.ts      # GET onboarding status
│           ├── skip/
│           │   └── route.ts      # POST skip onboarding
│           ├── save/
│           │   └── route.ts      # POST save progress
│           ├── chat/
│           │   └── route.ts      # POST streaming conversation
│           ├── recap/
│           │   └── route.ts      # POST generate recap
│           └── complete/
│               └── route.ts      # POST finalize onboarding
├── components/
│   └── onboarding/
│       ├── index.ts              # Barrel export
│       ├── onboarding-provider.tsx
│       ├── onboarding-flow.tsx
│       ├── onboarding-message.tsx
│       ├── onboarding-input.tsx
│       ├── onboarding-progress.tsx
│       ├── onboarding-core.tsx   # Animated AI orb
│       ├── onboarding-recap.tsx
│       ├── onboarding-complete.tsx
│       └── theme-selector.tsx
├── lib/
│   ├── llm/
│   │   └── prompts.ts            # Add onboarding prompts
│   └── onboarding/
│       ├── types.ts              # TypeScript types
│       └── script.ts             # Conversation script + utilities
└── types/
    └── index.ts                  # Re-export onboarding types

supabase/
└── migrations/
    └── 002_user_profiles.sql     # Database migration
```

---

## 10. Middleware Configuration

**No middleware changes required.** The existing middleware handles authentication only. Onboarding redirection is handled **client-side** in the dashboard layout.

The existing `src/middleware.ts` remains unchanged:

```typescript
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/inngest(.*)',
  '/api/nango/webhook(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
};
```

---

## 11. CSS Additions

Add to `src/app/globals.css`:

```css
/* ═══════════════════════════════════════════════════════════════
   Onboarding-Specific Styles
═══════════════════════════════════════════════════════════════ */

/* AI Core orb gradients */
:root {
  --orb-gradient-teal: radial-gradient(circle at 30% 30%, #0d9488, #134e4a 60%, #000 100%);
  --orb-gradient-purple: radial-gradient(circle at 30% 30%, #7c3aed, #4c1d95 60%, #000 100%);
  --orb-gradient-orange: radial-gradient(circle at 30% 30%, #f97316, #9a3412 60%, #000 100%);
  --orb-gradient-pink: radial-gradient(circle at 30% 30%, #ec4899, #831843 60%, #000 100%);
  --orb-gradient-blue: radial-gradient(circle at 30% 30%, #3b82f6, #1e3a8a 60%, #000 100%);
}

/* Message bubbles */
.onboarding-msg-user {
  @apply bg-white/[0.08] border border-primary/25 rounded-2xl;
  border-bottom-right-radius: 4px;
}

.onboarding-msg-ai {
  @apply bg-black/25 border border-accent/25 rounded-2xl;
  border-bottom-left-radius: 4px;
}

/* Orb animations */
@keyframes orb-pulse {
  0%, 100% {
    transform: scale(1);
    box-shadow: 0 0 60px rgba(78, 205, 196, 0.15);
  }
  50% {
    transform: scale(1.02);
    box-shadow: 0 0 80px rgba(78, 205, 196, 0.25);
  }
}

@keyframes ring-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes message-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes typing-blink {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

.animate-orb-pulse {
  animation: orb-pulse 4s ease-in-out infinite;
}

.animate-ring-spin {
  animation: ring-spin 20s linear infinite;
}

.animate-ring-spin-reverse {
  animation: ring-spin 25s linear infinite reverse;
}

.animate-message-in {
  animation: message-in 0.3s ease-out forwards;
}

.typing-dot {
  @apply w-2 h-2 rounded-full bg-muted-foreground;
  animation: typing-blink 1.4s ease-in-out infinite;
}

.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }

/* Theme color orbs */
.color-orb {
  @apply w-14 h-14 rounded-full cursor-pointer transition-all duration-200;
  @apply opacity-60 scale-90;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
}

.color-orb:hover {
  @apply opacity-100 scale-100;
}

.color-orb.selected {
  @apply opacity-100 scale-110 ring-2 ring-white;
  box-shadow: 0 0 25px rgba(255, 255, 255, 0.3);
}

/* Skip link */
.skip-link {
  @apply text-muted-foreground/60 text-sm transition-colors;
}

.skip-link:hover {
  @apply text-muted-foreground underline;
}
```

---

## 12. Implementation Phases

### Phase 1: Foundation (Day 1-2)
- [ ] Run database migration (`002_user_profiles.sql`)
- [ ] Create file structure per Section 9
- [ ] Implement types in `lib/onboarding/types.ts`
- [ ] Implement script data in `lib/onboarding/script.ts`
- [ ] Implement API routes: `status`, `skip`, `save`
- [ ] Create onboarding page shell with minimal layout

### Phase 2: Conversation (Day 3-4)
- [ ] Add LLM prompts to `lib/llm/prompts.ts`
- [ ] Implement `/api/onboarding/chat` with SSE streaming
- [ ] Build `onboarding-provider.tsx` with state management
- [ ] Build `onboarding-message.tsx` component
- [ ] Build `onboarding-input.tsx` component
- [ ] Build `onboarding-core.tsx` animated orb
- [ ] Implement conversation flow in `onboarding-flow.tsx`

### Phase 3: Recap & Assessment (Day 5)
- [ ] Implement `/api/onboarding/recap`
- [ ] Implement `/api/onboarding/complete`
- [ ] Build `onboarding-recap.tsx` component
- [ ] Build `onboarding-complete.tsx` component

### Phase 4: Integration (Day 6)
- [ ] Update dashboard layout with onboarding check
- [ ] Update Settings page with onboarding status card
- [ ] Implement theme selection with `theme-selector.tsx`
- [ ] Build `onboarding-progress.tsx` component
- [ ] Add CSS animations to `globals.css`

### Phase 5: Polish (Day 7)
- [ ] Animation refinements
- [ ] Error handling and fallbacks
- [ ] Loading states
- [ ] Unit and integration tests
- [ ] E2E tests
- [ ] Final QA and bug fixes

---

## 13. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| LLM response inconsistency | Strong prompt engineering + response validation |
| Slow conversation flow | SSE streaming + optimistic UI |
| User abandonment | Progress indicator + easy skip |
| Data loss on refresh | Auto-save via `/api/onboarding/save` |
| Theme conflicts | Scoped CSS variables |
| Rate limiting | Use existing `LLM_RETRY_DELAYS_MS` |
| Assessment failure | Fallback to template assessment |

---

## 14. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Completion Rate | >70% | Users who complete vs. start |
| Skip Rate | <40% | Users who skip initially |
| Resume Rate | >50% | Skipped users who complete later |
| Time to Complete | <5 min | Average duration |
| Error Rate | <1% | Failed onboarding attempts |

---

## Appendix A: Onboarding Page Layout

**File:** `src/app/onboarding/layout.tsx`

```typescript
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      {children}
    </div>
  );
}
```

---

## Appendix B: Frontend Context Provider

**File:** `src/components/onboarding/onboarding-provider.tsx`

```typescript
'use client';

import React, { createContext, useContext, useReducer } from 'react';
import type {
  OnboardingPhase,
  ConversationStep,
  OnboardingAnswers,
  OnboardingMessage,
  ThemeColor,
  UserAssessment,
} from '@/lib/onboarding/types';

interface OnboardingState {
  phase: OnboardingPhase;
  currentStep: ConversationStep;
  messages: OnboardingMessage[];
  isStreaming: boolean;
  answers: Partial<OnboardingAnswers>;
  displayName: string;
  themeColor: ThemeColor;
  recapContent: string | null;
  recapConfirmed: boolean;
  assessment: UserAssessment | null;
  error: string | null;
}

type OnboardingAction =
  | { type: 'SET_PHASE'; payload: OnboardingPhase }
  | { type: 'SET_STEP'; payload: ConversationStep }
  | { type: 'ADD_MESSAGE'; payload: OnboardingMessage }
  | { type: 'SET_STREAMING'; payload: boolean }
  | { type: 'SET_ANSWER'; payload: { key: string; value: string | { question: string; answer: string } } }
  | { type: 'SET_DISPLAY_NAME'; payload: string }
  | { type: 'SET_THEME_COLOR'; payload: ThemeColor }
  | { type: 'SET_RECAP'; payload: string }
  | { type: 'CONFIRM_RECAP' }
  | { type: 'SET_ASSESSMENT'; payload: UserAssessment }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'RESTORE_STATE'; payload: Partial<OnboardingState> };

const initialState: OnboardingState = {
  phase: 'intro',
  currentStep: 'focus',
  messages: [],
  isStreaming: false,
  answers: {},
  displayName: '',
  themeColor: 'teal',
  recapContent: null,
  recapConfirmed: false,
  assessment: null,
  error: null,
};

function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'SET_PHASE':
      return { ...state, phase: action.payload };
    case 'SET_STEP':
      return { ...state, currentStep: action.payload };
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };
    case 'SET_STREAMING':
      return { ...state, isStreaming: action.payload };
    case 'SET_ANSWER':
      return { ...state, answers: { ...state.answers, [action.payload.key]: action.payload.value } };
    case 'SET_DISPLAY_NAME':
      return { ...state, displayName: action.payload };
    case 'SET_THEME_COLOR':
      return { ...state, themeColor: action.payload };
    case 'SET_RECAP':
      return { ...state, recapContent: action.payload };
    case 'CONFIRM_RECAP':
      return { ...state, recapConfirmed: true };
    case 'SET_ASSESSMENT':
      return { ...state, assessment: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'RESTORE_STATE':
      return { ...state, ...action.payload };
    default:
      return state;
  }
}

interface OnboardingContextValue {
  state: OnboardingState;
  dispatch: React.Dispatch<OnboardingAction>;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(onboardingReducer, initialState);
  
  return (
    <OnboardingContext.Provider value={{ state, dispatch }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}
```