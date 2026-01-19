'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { useUser } from '@clerk/nextjs';
import {
  DailyBriefingWidget,
  ScheduleWidget,
  GoalProgressWidget,
  KeyDecisionsWidget
} from '@/components/dashboard';

export default function DashboardPage() {
  const { isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[calc(100vh-8rem)]">
        <div className="lg:col-span-2"><Skeleton className="h-full w-full rounded-xl" /></div>
        <div className="lg:col-span-1"><Skeleton className="h-full w-full rounded-xl" /></div>
        <div className="lg:col-span-1"><Skeleton className="h-full w-full rounded-xl" /></div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)]">
      {/* Compact 4-column grid layout that fits on one screen */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-full">
        {/* Left: Daily Briefing (2 cols, full height) */}
        <div className="lg:col-span-2 lg:row-span-2 min-h-0">
          <DailyBriefingWidget />
        </div>

        {/* Top Right: Schedule (2 cols) */}
        <div className="lg:col-span-2 min-h-0">
          <ScheduleWidget />
        </div>

        {/* Bottom Right: Goals and Decisions (1 col each) */}
        <div className="lg:col-span-1 min-h-0">
          <GoalProgressWidget />
        </div>
        <div className="lg:col-span-1 min-h-0">
          <KeyDecisionsWidget />
        </div>
      </div>
    </div>
  );
}
