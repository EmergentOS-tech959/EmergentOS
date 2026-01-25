'use client';

/**
 * EmergentOS - Onboarding Page
 * 
 * Full-screen onboarding experience with conversational interface.
 */

import { OnboardingProvider, OnboardingFlow } from '@/components/onboarding';

export default function OnboardingPage() {
  return (
    <OnboardingProvider>
      <OnboardingFlow />
    </OnboardingProvider>
  );
}
