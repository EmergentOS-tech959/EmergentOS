'use client';

/**
 * EmergentOS - Onboarding Provider
 * 
 * React context for managing onboarding state across components.
 */

import React, { createContext, useContext, useReducer, useCallback } from 'react';
import type {
  OnboardingState,
  OnboardingAction,
  OnboardingPhase,
  ConversationStep,
  ThemeColor,
  OnboardingMessage,
  OnboardingAnswers,
  UserAssessment,
  ContextAnswer,
} from '@/lib/onboarding/types';

// ============================================================================
// Initial State
// ============================================================================

const initialState: OnboardingState = {
  phase: 'intro',
  currentStep: 'focus',
  messages: [],
  isTyping: false,
  answers: {},
  displayName: '',
  themeColor: 'teal',
  recapContent: null,
  recapConfirmed: false,
  assessment: null,
  error: null,
  isLoading: false,
};

// ============================================================================
// Reducer
// ============================================================================

function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'SET_PHASE':
      return { ...state, phase: action.payload };
    case 'SET_STEP':
      return { ...state, currentStep: action.payload };
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };
    case 'UPDATE_LAST_MESSAGE':
      const messages = [...state.messages];
      if (messages.length > 0) {
        messages[messages.length - 1] = {
          ...messages[messages.length - 1],
          content: action.payload,
          isTyping: false,
        };
      }
      return { ...state, messages };
    case 'SET_TYPING':
      return { ...state, isTyping: action.payload };
    case 'SET_ANSWER':
      return { 
        ...state, 
        answers: { ...state.answers, [action.payload.key]: action.payload.value } 
      };
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
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'RESTORE_STATE':
      return { ...state, ...action.payload };
    default:
      return state;
  }
}

// ============================================================================
// Context
// ============================================================================

interface OnboardingContextValue {
  state: OnboardingState;
  dispatch: React.Dispatch<OnboardingAction>;
  // Convenience actions
  setPhase: (phase: OnboardingPhase) => void;
  setStep: (step: ConversationStep) => void;
  addMessage: (message: OnboardingMessage) => void;
  updateLastMessage: (content: string) => void;
  setTyping: (isTyping: boolean) => void;
  setAnswer: (key: string, value: string | ContextAnswer) => void;
  setRecap: (recap: string) => void;
  confirmRecap: () => void;
  setAssessment: (assessment: UserAssessment) => void;
  setError: (error: string | null) => void;
  setLoading: (isLoading: boolean) => void;
  restoreState: (state: Partial<OnboardingState>) => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

// ============================================================================
// Provider Component
// ============================================================================

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(onboardingReducer, initialState);

  // Convenience action creators
  const setPhase = useCallback((phase: OnboardingPhase) => {
    dispatch({ type: 'SET_PHASE', payload: phase });
  }, []);

  const setStep = useCallback((step: ConversationStep) => {
    dispatch({ type: 'SET_STEP', payload: step });
  }, []);

  const addMessage = useCallback((message: OnboardingMessage) => {
    dispatch({ type: 'ADD_MESSAGE', payload: message });
  }, []);

  const updateLastMessage = useCallback((content: string) => {
    dispatch({ type: 'UPDATE_LAST_MESSAGE', payload: content });
  }, []);

  const setTyping = useCallback((isTyping: boolean) => {
    dispatch({ type: 'SET_TYPING', payload: isTyping });
  }, []);

  const setAnswer = useCallback((key: string, value: string | ContextAnswer) => {
    dispatch({ type: 'SET_ANSWER', payload: { key, value } });
  }, []);

  const setRecap = useCallback((recap: string) => {
    dispatch({ type: 'SET_RECAP', payload: recap });
  }, []);

  const confirmRecap = useCallback(() => {
    dispatch({ type: 'CONFIRM_RECAP' });
  }, []);

  const setAssessment = useCallback((assessment: UserAssessment) => {
    dispatch({ type: 'SET_ASSESSMENT', payload: assessment });
  }, []);

  const setError = useCallback((error: string | null) => {
    dispatch({ type: 'SET_ERROR', payload: error });
  }, []);

  const setLoading = useCallback((isLoading: boolean) => {
    dispatch({ type: 'SET_LOADING', payload: isLoading });
  }, []);

  const restoreState = useCallback((newState: Partial<OnboardingState>) => {
    dispatch({ type: 'RESTORE_STATE', payload: newState });
  }, []);

  const value: OnboardingContextValue = {
    state,
    dispatch,
    setPhase,
    setStep,
    addMessage,
    updateLastMessage,
    setTyping,
    setAnswer,
    setRecap,
    confirmRecap,
    setAssessment,
    setError,
    setLoading,
    restoreState,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}
