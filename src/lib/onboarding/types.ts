/**
 * EmergentOS - Onboarding Type Definitions
 */

export type ConversationStep = 
  | 'focus'
  | 'decisions'
  | 'flow'
  | 'blockers'
  | 'immediate'
  | 'context1'
  | 'context2';

export type OnboardingPhase = 
  | 'intro'
  | 'conversation'
  | 'recap'
  | 'complete';

export type OnboardingStatus = 
  | 'pending'
  | 'in_progress'
  | 'skipped'
  | 'completed';

export type ThemeColor = 'teal' | 'purple' | 'orange' | 'pink' | 'blue';

export interface DynamicQuestion {
  id: string;
  question: string;
  triggers: string[];
  priority: number;
}

export interface StepConfig {
  section: number;
  sectionTitle?: string;
  sectionIntro?: string;
  question?: string;
  hint?: string;
  isDynamic?: boolean;
  reflections: string[];
}

export interface ContextAnswer {
  question: string;
  answer: string;
}

export interface OnboardingAnswers {
  focus?: string;
  decisions?: string;
  flow?: string;
  blockers?: string;
  immediate?: string;
  context1?: ContextAnswer;
  context2?: ContextAnswer;
}

export interface OnboardingMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isTyping?: boolean;
}

export interface WorkStyle {
  decisionApproach: 'analytical' | 'intuitive' | 'collaborative' | 'deliberate';
  energyPattern: 'morning_peak' | 'afternoon_peak' | 'evening_peak' | 'steady';
  collaborationStyle: 'async_preferred' | 'sync_preferred' | 'mixed';
}

export interface PersonalityInsights {
  driverTraits: string[];
  stressors: string[];
  motivators: string[];
}

export interface UserAssessment {
  generatedAt: string;
  profileSummary: string;
  workStyle: WorkStyle;
  priorities: string[];
  suggestedFocus: string[];
  personalityInsights: PersonalityInsights;
}

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

export interface OnboardingStatusResponse {
  status: OnboardingStatus;
  hasProfile: boolean;
  currentStep: ConversationStep | null;
  displayName: string | null;
  themeColor: ThemeColor;
  answers: Partial<OnboardingAnswers>;
}

export interface RecapResponse {
  recap: string;
  success: boolean;
}

export interface CompleteResponse {
  success: boolean;
  assessment: UserAssessment;
  message: string;
}

export interface OnboardingState {
  phase: OnboardingPhase;
  currentStep: ConversationStep;
  messages: OnboardingMessage[];
  isTyping: boolean;
  answers: Partial<OnboardingAnswers>;
  displayName: string;
  themeColor: ThemeColor;
  recapContent: string | null;
  recapConfirmed: boolean;
  assessment: UserAssessment | null;
  error: string | null;
  isLoading: boolean;
}

export type OnboardingAction =
  | { type: 'SET_PHASE'; payload: OnboardingPhase }
  | { type: 'SET_STEP'; payload: ConversationStep }
  | { type: 'ADD_MESSAGE'; payload: OnboardingMessage }
  | { type: 'UPDATE_LAST_MESSAGE'; payload: string }
  | { type: 'SET_TYPING'; payload: boolean }
  | { type: 'SET_ANSWER'; payload: { key: string; value: string | ContextAnswer } }
  | { type: 'SET_DISPLAY_NAME'; payload: string }
  | { type: 'SET_THEME_COLOR'; payload: ThemeColor }
  | { type: 'SET_RECAP'; payload: string }
  | { type: 'CONFIRM_RECAP' }
  | { type: 'SET_ASSESSMENT'; payload: UserAssessment }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'RESTORE_STATE'; payload: Partial<OnboardingState> };
