'use client';

/**
 * EmergentOS - Dashboard Page
 * 
 * Phase 1: Clean 2-column layout focused on core value proposition
 * - Left: Today's Schedule with AI Analysis
 * - Right: Daily Briefing with Executive Summary
 */

import { Skeleton } from '@/components/ui/skeleton';
import { useUser } from '@clerk/nextjs';
import { DailyBriefingWidget, ScheduleWidget } from '@/components/dashboard';

export default function DashboardPage() {
  const { isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div className="h-full w-full">
        {/* Loading skeleton - matches 2-column layout */}
        <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6 h-[calc(100vh-6.5rem)]">
              <Skeleton className="h-full w-full rounded-xl" />
              <Skeleton className="h-full w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      {/* 
        Phase 1: Two-column layout for maximum focus on core features
        - Equal prominence for Schedule and Briefing
        - Full height utilization for both widgets
        - Clean, professional appearance
      */}
      <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6 h-[calc(100vh-6.5rem)]">
        {/* Left Column: Today's Schedule */}
        <div className="min-h-0 h-full">
          <ScheduleWidget />
        </div>

        {/* Right Column: Daily Briefing */}
        <div className="min-h-0 h-full">
            <DailyBriefingWidget />
        </div>
      </div>
    </div>
  );
}
