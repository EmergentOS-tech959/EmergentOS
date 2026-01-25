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
      <div className="h-full w-full">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 h-[calc(100vh-6.5rem)]">
          <div className="lg:col-span-5"><Skeleton className="h-full w-full rounded-xl" /></div>
          <div className="lg:col-span-4"><Skeleton className="h-full w-full rounded-xl" /></div>
          <div className="lg:col-span-3 flex flex-col gap-4 lg:gap-5">
            <Skeleton className="flex-1 w-full rounded-xl" />
            <Skeleton className="flex-1 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      {/* 12-column grid - fills available space with equal padding from app-shell */}
      <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 h-[calc(100vh-6.5rem)]">
        {/* Left: Today's Schedule (5 cols - ~42%) */}
        <div className="lg:col-span-5 min-h-0 h-full">
          <ScheduleWidget />
        </div>

        {/* Middle: Daily Briefing (4 cols - ~33%) */}
        <div className="lg:col-span-4 min-h-0 h-full">
          <DailyBriefingWidget />
        </div>

        {/* Right: Goals & Decisions stacked (3 cols - ~25%) */}
        <div className="lg:col-span-3 min-h-0 h-full flex flex-col gap-4 lg:gap-5">
          <div className="flex-1 min-h-0">
            <GoalProgressWidget />
          </div>
          <div className="flex-1 min-h-0">
            <KeyDecisionsWidget />
          </div>
        </div>
      </div>
    </div>
  );
}
