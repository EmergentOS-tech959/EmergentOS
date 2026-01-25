'use client';

/**
 * EmergentOS - Onboarding Flow
 * 
 * Main orchestrator component for the onboarding conversation flow.
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

import { useOnboarding } from './onboarding-provider';
import { OnboardingLogo } from './onboarding-logo';
import { OnboardingChat } from './onboarding-chat';
import { OnboardingInput } from './onboarding-input';
import { OnboardingRecap } from './onboarding-recap';

import {
  ONBOARDING_SCRIPT,
  getNextStep,
  getQuestionForStep,
  getReflectionForStep,
  getRandomPrimer,
  getRandomClosingLine,
  getStepIndex,
  getTotalSteps,
  selectDynamicQuestions,
} from '@/lib/onboarding/script';

import type { OnboardingMessage, OnboardingAnswers } from '@/lib/onboarding/types';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ProgressIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">
        Step {current} of {total}
      </span>
      <div className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={cn(
              'w-2 h-2 rounded-full transition-colors',
              i < current ? 'bg-teal-500' : 'bg-border'
            )}
          />
        ))}
      </div>
    </div>
  );
}

export function OnboardingFlow() {
  const router = useRouter();
  const {
    state,
    setPhase,
    setStep,
    addMessage,
    setTyping,
    setAnswer,
    setRecap,
    confirmRecap,
    setAssessment,
    setError,
    setLoading,
    restoreState,
  } = useOnboarding();

  const [isInitialized, setIsInitialized] = useState(false);
  const [activeTypingMessageId, setActiveTypingMessageId] = useState<string | null>(null);
  
  // Queue for messages that need to type sequentially
  const messageQueueRef = useRef<OnboardingMessage[]>([]);
  const isProcessingQueueRef = useRef(false);
  // Callback to execute when queue is empty
  const onQueueEmptyRef = useRef<(() => void) | null>(null);

  // Process the next message in queue
  const processNextInQueue = useCallback(() => {
    if (messageQueueRef.current.length === 0) {
      isProcessingQueueRef.current = false;
      setActiveTypingMessageId(null);
      // Execute callback if one is waiting
      if (onQueueEmptyRef.current) {
        const callback = onQueueEmptyRef.current;
        onQueueEmptyRef.current = null;
        callback();
      }
      return;
    }

    const nextMessage = messageQueueRef.current.shift()!;
    addMessage(nextMessage);
    setActiveTypingMessageId(nextMessage.id);
  }, [addMessage]);

  // Handler for when a message finishes typing
  const handleTypingComplete = useCallback((messageId: string) => {
    // Small delay before next message to let user read
    setTimeout(() => {
      processNextInQueue();
    }, 800);
  }, [processNextInQueue]);

  // Add a message to the typing queue
  const queueTypingMessage = useCallback((message: OnboardingMessage) => {
    messageQueueRef.current.push(message);
    
    if (!isProcessingQueueRef.current) {
      isProcessingQueueRef.current = true;
      processNextInQueue();
    }
  }, [processNextInQueue]);

  const showIntroSequence = useCallback(async () => {
    setTyping(true);
    await delay(800);
    setTyping(false);

    const greetingContent = `${ONBOARDING_SCRIPT.intro.greeting}\n${ONBOARDING_SCRIPT.intro.followUp}\n${getRandomPrimer()}`;
    const greeting: OnboardingMessage = {
      id: `msg-greeting-${Date.now()}`,
      role: 'assistant',
      content: greetingContent,
      timestamp: new Date().toISOString(),
      isTyping: true,
    };

    const stepConfig = ONBOARDING_SCRIPT.steps.focus;
    const firstQuestion: OnboardingMessage = {
      id: `msg-question-${Date.now() + 1}`,
      role: 'assistant',
      content: `${stepConfig.sectionIntro}\n${stepConfig.question}`,
      timestamp: new Date().toISOString(),
      isTyping: true,
    };

    // Queue both messages - they will type sequentially
    queueTypingMessage(greeting);
    queueTypingMessage(firstQuestion);

    setPhase('conversation');
  }, [setTyping, setPhase, queueTypingMessage]);

  const generateRecap = useCallback(async (answers: OnboardingAnswers) => {
    setLoading(true);
    setTyping(true);

    try {
      const response = await fetch('/api/onboarding/recap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });

      if (!response.ok) throw new Error('Failed to generate recap');

      const data = await response.json();
      setRecap(data.recap);
      setPhase('recap');
    } catch (error) {
      console.error('[OnboardingFlow] Recap error:', error);
      toast.error('Failed to generate recap. Please try again.');
      setError('Failed to generate recap');
    } finally {
      setLoading(false);
      setTyping(false);
    }
  }, [setLoading, setTyping, setRecap, setPhase, setError]);

  const completeOnboarding = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: state.answers,
          confirmedRecap: state.recapContent,
          displayName: state.displayName,
          themeColor: state.themeColor,
        }),
      });

      if (!response.ok) throw new Error('Failed to complete onboarding');

      const data = await response.json();
      setAssessment(data.assessment);
      setPhase('complete');

      await delay(3000);
      router.replace('/dashboard');
    } catch (error) {
      console.error('[OnboardingFlow] Complete error:', error);
      toast.error('Failed to complete onboarding. Please try again.');
      setError('Failed to complete onboarding');
    } finally {
      setLoading(false);
    }
  }, [state, setLoading, setAssessment, setPhase, setError, router]);

  useEffect(() => {
    if (isInitialized) return;

    const initializeOnboarding = async () => {
      try {
        const response = await fetch('/api/onboarding/status');
        const data = await response.json();

        if (data.status === 'completed') {
          router.replace('/dashboard');
          return;
        }

        if (data.status === 'in_progress' && data.currentStep && data.answers) {
          restoreState({
            currentStep: data.currentStep,
            answers: data.answers,
            displayName: data.displayName || '',
            themeColor: data.themeColor || 'teal',
            phase: 'conversation',
          });
          
          const welcomeBack: OnboardingMessage = {
            id: `msg-welcome-${Date.now()}`,
            role: 'assistant',
            content: `Welcome back! Let's continue where we left off. ${getQuestionForStep(data.currentStep, data.answers)}`,
            timestamp: new Date().toISOString(),
            isTyping: true,
          };
          queueTypingMessage(welcomeBack);
        } else {
          await showIntroSequence();
        }

        setIsInitialized(true);
      } catch (error) {
        console.error('[OnboardingFlow] Init error:', error);
        await showIntroSequence();
        setIsInitialized(true);
      }
    };

    initializeOnboarding();
  }, [isInitialized, router, restoreState, addMessage, showIntroSequence, queueTypingMessage]);

  const handleUserMessage = useCallback(async (message: string) => {
    const { currentStep, answers } = state;

    const userMsg: OnboardingMessage = {
      id: `msg-user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    addMessage(userMsg);

    if (currentStep === 'context1' || currentStep === 'context2') {
      const { q1, q2 } = selectDynamicQuestions(answers);
      const question = currentStep === 'context1' ? q1.question : q2.question;
      setAnswer(currentStep, { question, answer: message });
    } else {
      setAnswer(currentStep, message);
    }

    const updatedAnswers = {
      ...answers,
      [currentStep]: currentStep === 'context1' || currentStep === 'context2'
        ? { question: getQuestionForStep(currentStep, answers), answer: message }
        : message,
    };

    try {
      await fetch('/api/onboarding/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentStep, answers: updatedAnswers }),
      });
    } catch (error) {
      console.error('[OnboardingFlow] Save error:', error);
    }

    const nextStep = getNextStep(currentStep);

    if (!nextStep) {
      setTyping(true);
      await delay(800);
      setTyping(false);

      const reflection = getReflectionForStep(currentStep);
      const transitionMsg: OnboardingMessage = {
        id: `msg-transition-${Date.now()}`,
        role: 'assistant',
        content: `${reflection}\n${ONBOARDING_SCRIPT.wrapUp.thanks} Let me put together a quick summary of what I've learned...`,
        timestamp: new Date().toISOString(),
        isTyping: true,
      };
      
      // Set callback to generate recap AFTER transition message finishes typing
      onQueueEmptyRef.current = () => {
        generateRecap(updatedAnswers as OnboardingAnswers);
      };
      
      queueTypingMessage(transitionMsg);
      return;
    }

    setTyping(true);
    await delay(1200);
    setTyping(false);

    let responseContent = getReflectionForStep(currentStep);
    
    const nextStepConfig = ONBOARDING_SCRIPT.steps[nextStep];
    if (nextStepConfig.sectionTitle && nextStepConfig.sectionIntro) {
      responseContent += `\n${nextStepConfig.sectionIntro}`;
    }

    const nextQuestion = getQuestionForStep(nextStep, updatedAnswers);
    responseContent += `\n${nextQuestion}`;

    const responseMsg: OnboardingMessage = {
      id: `msg-response-${Date.now()}`,
      role: 'assistant',
      content: responseContent,
      timestamp: new Date().toISOString(),
      isTyping: true,
    };
    queueTypingMessage(responseMsg);

    setStep(nextStep);
  }, [state, addMessage, setAnswer, setTyping, setStep, generateRecap, queueTypingMessage]);

  const handleRecapConfirm = useCallback(async () => {
    confirmRecap();
    await completeOnboarding();
  }, [confirmRecap, completeOnboarding]);

  const handleRestart = useCallback(() => {
    window.location.reload();
  }, []);

  const handleSkip = useCallback(async () => {
    try {
      await fetch('/api/onboarding/skip', { method: 'POST' });
      toast.info('Onboarding skipped', {
        description: 'You can complete it anytime from Settings.',
      });
      router.replace('/dashboard');
    } catch (error) {
      console.error('[OnboardingFlow] Skip error:', error);
      router.replace('/dashboard');
    }
  }, [router]);

  if (!isInitialized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen onboarding-bg relative overflow-hidden">
         {/* Ambient background effects */}
         <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[60%] rounded-full bg-teal-500/5 blur-[120px]" />
        </div>
        
        <div className="relative z-10 flex flex-col items-center animate-fade-in">
           <OnboardingLogo />
           <div className="mt-8 flex flex-col items-center gap-2">
             <Loader2 className="h-5 w-5 text-teal-500 animate-spin" />
             <span className="text-xs text-muted-foreground/50 animate-pulse">Initializing system...</span>
           </div>
        </div>
      </div>
    );
  }

  if (state.phase === 'complete') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4">
        <div className="text-center max-w-md animate-scale-in">
          <div className="w-16 h-16 rounded-full bg-teal-500/20 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="h-8 w-8 text-teal-500" />
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-2">
            You're all set!
          </h2>
          <p className="text-muted-foreground mb-4">
            {getRandomClosingLine()}
          </p>
          <p className="text-sm text-muted-foreground">
            Redirecting to your dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (state.phase === 'recap' && state.recapContent) {
    return (
      <div className="flex flex-col min-h-screen">
        <div className="py-8 flex justify-center">
          <OnboardingLogo />
        </div>
        
        <div className="flex-1 flex items-center">
          <OnboardingRecap
            recap={state.recapContent}
            onConfirm={handleRecapConfirm}
            onRestart={handleRestart}
            className="w-full"
          />
        </div>

        <div className="p-4 flex justify-center">
          <button
            onClick={handleSkip}
            className="text-sm text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen onboarding-bg overflow-hidden relative selection:bg-teal-500/20">
      {/* Ambient background effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-teal-500/5 blur-[100px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-500/5 blur-[100px]" />
      </div>

      <header className="pt-8 pb-4 flex flex-col items-center justify-center shrink-0 z-10 relative">
        <div className="flex items-end gap-0.5 mb-3">
          <div className="w-12 h-12 flex items-center justify-center relative -mb-1">
             <Image
              src="/logo.png"
              alt="EmergentOS"
              width={48}
              height={48}
              className="object-contain brightness-0 invert opacity-90 relative z-10"
             />
          </div>
          <span className="text-3xl font-semibold text-foreground tracking-tight leading-none">mergentOS</span>
        </div>

        <div className="flex justify-center">
           <ProgressIndicator 
            current={getStepIndex(state.currentStep)} 
            total={getTotalSteps()} 
          />
        </div>
      </header>

      <main className="flex-1 flex flex-col relative z-0 max-w-3xl mx-auto w-full overflow-hidden">
        <OnboardingChat
          messages={state.messages}
          isTyping={state.isTyping}
          activeTypingMessageId={activeTypingMessageId}
          onTypingComplete={handleTypingComplete}
          className="flex-1 w-full"
        />

        <div className="shrink-0 p-4 sm:p-6 pb-2 w-full">
          <div className="max-w-2xl mx-auto w-full">
            <OnboardingInput
              onSend={handleUserMessage}
              disabled={state.isTyping || state.isLoading}
              placeholder="Type your response..."
            />
            
            <div className="flex flex-col items-center gap-2 mt-2">
                <p className="text-[10px] text-muted-foreground/40 text-center">
                    Press Enter to send • Shift + Enter for new line
                </p>
                
                <div className="flex items-center gap-4">
                  <button
                      onClick={handleSkip}
                      className="text-xs text-muted-foreground/40 hover:text-muted-foreground transition-colors px-3 py-1.5 rounded-full hover:bg-secondary/30"
                  >
                      Skip Setup
                  </button>

                  <button
                      onClick={() => window.location.reload()}
                      className="text-xs text-muted-foreground/40 hover:text-muted-foreground transition-colors px-3 py-1.5 rounded-full hover:bg-secondary/30"
                  >
                      Restart
                  </button>
                </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

