'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useUser } from '@clerk/nextjs';
import { RefreshCw } from 'lucide-react';
import {
  DailyBriefingWidget,
  ScheduleWidget,
  GoalProgressWidget,
  KeyDecisionsWidget
} from '@/components/dashboard';
import { useSyncManager, type ProviderKey } from '@/lib/sync-manager';
import { toast } from 'sonner';

export default function DashboardPage() {
  const { isLoaded } = useUser();
  const { providers, syncAll, isSyncing, displayStrings } = useSyncManager();

  // Count connected providers
  const connectedCount = (['gmail', 'calendar', 'drive'] as ProviderKey[])
    .filter((p) => providers[p].status === 'connected').length;

  const handleRefresh = async () => {
    if (connectedCount === 0) {
      toast.warning('No sources connected', {
        description: 'Connect Gmail, Calendar, or Drive in Settings to sync data.',
      });
      return;
    }
    
    try {
      // Manual trigger = ALWAYS regenerate briefing
      // Toast notifications are handled by sync-manager
      await syncAll({ trigger: 'manual', forceRegenerate: true });
    } catch {
      toast.error('Refresh failed');
    }
  };

  if (!isLoaded) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[calc(100vh-10rem)]">
          <div className="lg:col-span-2"><Skeleton className="h-full w-full rounded-xl" /></div>
          <div className="lg:col-span-1"><Skeleton className="h-full w-full rounded-xl" /></div>
          <div className="lg:col-span-1"><Skeleton className="h-full w-full rounded-xl" /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)]">
      {/* Unified Refresh Button - top right */}
      <div className="flex items-center justify-end gap-3 mb-4">
        <span className="text-xs text-muted-foreground">
          {connectedCount > 0 
            ? `${connectedCount} source${connectedCount !== 1 ? 's' : ''} · ${displayStrings.global}`
            : 'No sources connected'}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={connectedCount === 0 || isSyncing}
          className="gap-2 h-9"
        >
          <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Refreshing...' : 'Refresh Data'}
        </Button>
      </div>

      {/* Compact 4-column grid layout that fits on one screen */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[calc(100%-3rem)]">
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
