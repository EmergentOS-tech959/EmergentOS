/**
 * EmergentOS - Onboarding Script Data
 * 
 * Conversation script and utilities for the onboarding flow.
 * Based on the EmergentOS Onboarding Script v3.
 */

import type { ConversationStep, DynamicQuestion, StepConfig } from './types';

// ============================================================================
// Onboarding Script Data
// ============================================================================

export const ONBOARDING_SCRIPT = {
  intro: {
    greeting: "Hello, and welcome to EmergentOS — your personal operating system.",
    followUp: "I'm here to ask you a few quick questions to personalise your experience. You can type your answers — whatever feels easiest for you.",
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
      question: "How do you usually make decisions? More instinctively, or after gathering lots of input?",
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
  } as Record<ConversationStep, StepConfig>,
  
  dynamicQuestions: [
    {
      id: "launch",
      triggers: ["launch", "milestone", "deadline", "goal", "ship", "release", "product"],
      question: "What would make you feel 100% ready for that launch or milestone?",
      priority: 1
    },
    {
      id: "stress",
      triggers: ["overwhelm", "stress", "distract", "overload", "anxious", "busy", "tired"],
      question: "What tends to bring you back when you're feeling distracted or overloaded?",
      priority: 2
    },
    {
      id: "decisions",
      triggers: ["decision", "choose", "option", "choice", "uncertain", "unsure"],
      question: "Are there any decisions you'd like me to streamline or take off your plate?",
      priority: 3
    },
    {
      id: "delayed",
      triggers: ["idea", "project", "backlog", "someday", "postpone", "later", "wishlist"],
      question: "What's one idea or project that keeps getting pushed back?",
      priority: 4
    },
    {
      id: "team",
      triggers: ["team", "collaborate", "timezone", "async", "handoff", "colleague", "coworker"],
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

// ============================================================================
// Step Progression
// ============================================================================

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
 * Get step index (1-based for display)
 */
export function getStepIndex(step: ConversationStep): number {
  return STEP_ORDER.indexOf(step) + 1;
}

/**
 * Get total step count
 */
export function getTotalSteps(): number {
  return STEP_ORDER.length;
}

// ============================================================================
// Dynamic Question Selection
// ============================================================================

/**
 * Select dynamic questions based on previous answers
 */
export function selectDynamicQuestions(
  answers: Record<string, string | { question: string; answer: string } | undefined>
): { q1: DynamicQuestion; q2: DynamicQuestion } {
  // Combine all text answers into one string for matching
  const allText = Object.values(answers)
    .map(v => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object' && 'answer' in v) return v.answer;
      return '';
    })
    .join(' ')
    .toLowerCase();
  
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

/**
 * Get the question text for a step
 */
export function getQuestionForStep(
  step: ConversationStep,
  answers: Record<string, string | { question: string; answer: string } | undefined>
): string {
  const stepConfig = ONBOARDING_SCRIPT.steps[step];
  
  if (stepConfig.isDynamic) {
    const { q1, q2 } = selectDynamicQuestions(answers);
    return step === 'context1' ? q1.question : q2.question;
  }
  
  return stepConfig.question || '';
}

/**
 * Get a random reflection for a step
 */
export function getReflectionForStep(step: ConversationStep): string {
  const stepConfig = ONBOARDING_SCRIPT.steps[step];
  const reflections = stepConfig.reflections;
  return reflections[Math.floor(Math.random() * reflections.length)];
}

/**
 * Get a random primer
 */
export function getRandomPrimer(): string {
  const primers = ONBOARDING_SCRIPT.intro.primers;
  return primers[Math.floor(Math.random() * primers.length)];
}

/**
 * Get a random closing line
 */
export function getRandomClosingLine(): string {
  const lines = ONBOARDING_SCRIPT.wrapUp.closingLines;
  return lines[Math.floor(Math.random() * lines.length)];
}

// ============================================================================
// Section Utilities
// ============================================================================

/**
 * Check if step is first in its section
 */
export function isFirstInSection(step: ConversationStep): boolean {
  const stepConfig = ONBOARDING_SCRIPT.steps[step];
  return !!stepConfig.sectionTitle;
}

/**
 * Get section intro if applicable
 */
export function getSectionIntro(step: ConversationStep): { title: string; intro: string } | null {
  const stepConfig = ONBOARDING_SCRIPT.steps[step];
  if (stepConfig.sectionTitle && stepConfig.sectionIntro) {
    return {
      title: stepConfig.sectionTitle,
      intro: stepConfig.sectionIntro
    };
  }
  return null;
}
