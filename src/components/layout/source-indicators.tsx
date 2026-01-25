'use client';

import { useState, useEffect, useRef } from 'react';
import { Mail, Calendar, FileText, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSyncManager, type ProviderKey } from '@/lib/sync-manager';

interface SourceIndicatorsProps {
  isCollapsed: boolean;
}

const sources = [
  { key: 'gmail' as ProviderKey, icon: Mail, label: 'Gmail', activeColor: 'text-rose-400', activeBg: 'bg-rose-500/10' },
  { key: 'calendar' as ProviderKey, icon: Calendar, label: 'Calendar', activeColor: 'text-sky-400', activeBg: 'bg-sky-500/10' },
  { key: 'drive' as ProviderKey, icon: FileText, label: 'Drive', activeColor: 'text-emerald-400', activeBg: 'bg-emerald-500/10' },
];

export function SourceIndicators({ isCollapsed }: SourceIndicatorsProps) {
  const { providers, displayStrings, isInitialized, syncAll } = useSyncManager();
  const [isRenderedCollapsed, setIsRenderedCollapsed] = useState(isCollapsed);
  // Track how many items are visible (0-3), items appear from right to left
  const [visibleCount, setVisibleCount] = useState(isCollapsed ? 0 : 3);
  const [showRefreshButton, setShowRefreshButton] = useState(!isCollapsed);
  const timersRef = useRef<NodeJS.Timeout[]>([]);

  // Clear all timers
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  // Handle transition logic
  useEffect(() => {
    clearTimers();

    if (isCollapsed) {
      // Immediate switch when collapsing
      setIsRenderedCollapsed(true);
      setVisibleCount(0);
      setShowRefreshButton(false);
    } else {
      // Delayed expansion with staggered item reveal
      // Wait for sidebar to start expanding
      const startDelay = 150;
      const itemDelay = 80; // Time between each item appearing

      // First, switch to expanded layout
      const layoutTimer = setTimeout(() => {
        setIsRenderedCollapsed(false);
      }, startDelay);
      timersRef.current.push(layoutTimer);

      // Then reveal items one by one from right (Drive -> Calendar -> Gmail)
      // visibleCount: 1 = Drive visible, 2 = Drive+Calendar, 3 = all visible
      for (let i = 1; i <= 3; i++) {
        const timer = setTimeout(() => {
          setVisibleCount(i);
        }, startDelay + 50 + (i * itemDelay));
        timersRef.current.push(timer);
      }

      // Finally show refresh button
      const buttonTimer = setTimeout(() => {
        setShowRefreshButton(true);
      }, startDelay + 50 + (4 * itemDelay));
      timersRef.current.push(buttonTimer);
    }

    return clearTimers;
  }, [isCollapsed]);

  const isAnySyncing = Object.values(providers).some(p => p.isSyncing);
  const isAnyConnected = Object.values(providers).some(p => p.status === 'connected');
  const canRefresh = isAnyConnected && !isAnySyncing;

  const handleRefresh = async () => {
    if (!canRefresh) return;
    await syncAll({ trigger: 'manual' });
  };

  // Render collapsed view (vertical stack)
  if (isRenderedCollapsed) {
    return (
      <div className="border-t border-white/[0.06] px-2 py-2.5">
        <div className="flex flex-col gap-1.5">
          {sources.map(({ key, icon: Icon, label, activeColor, activeBg }) => {
            const provider = isInitialized ? providers[key] : null;
            const isSyncing = provider?.isSyncing ?? false;
            const isConnected = provider?.status === 'connected';
            const isError = provider?.status === 'error';

            return (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      'flex items-center justify-center w-full h-8 rounded-md transition-colors',
                      isConnected && activeBg,
                      isError && 'bg-red-500/10',
                      !isConnected && !isError && 'bg-white/[0.02] hover:bg-white/[0.04]',
                      isSyncing && 'animate-pulse'
                    )}
                  >
                    <div className="relative">
                      <Icon className={cn(
                        'h-4 w-4',
                        isConnected && !isSyncing && activeColor,
                        isSyncing && 'text-sky-400',
                        isError && 'text-red-400',
                        !isConnected && !isError && !isSyncing && 'text-muted-foreground/40'
                      )} />
      <div className={cn(
                        'absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-[#0d1117]',
                        isConnected && !isSyncing && 'bg-emerald-500',
                        isSyncing && 'bg-sky-500',
                        isError && 'bg-red-500',
                        !isConnected && !isError && !isSyncing && 'bg-muted-foreground/30'
      )}>
                        {isSyncing && <RefreshCw className="h-1.5 w-1.5 text-white animate-spin absolute top-0.5 left-0.5" />}
                      </div>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={10} className="glass border-border/60 px-3 py-2">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-foreground text-sm">{label}</span>
                      <span className={cn(
                        'text-[9px] font-medium px-1.5 py-0.5 rounded-full',
                        isConnected && 'bg-emerald-500/15 text-emerald-400',
                        isSyncing && 'bg-sky-500/15 text-sky-400',
                        isError && 'bg-red-500/15 text-red-400',
                        !isConnected && !isError && !isSyncing && 'bg-muted text-muted-foreground'
                      )}>
                        {isSyncing ? 'Syncing' : isConnected ? 'Active' : isError ? 'Error' : 'Offline'}
            </span>
          </div>
                    {!isConnected && !isError && (
                      <span className="text-[10px] text-muted-foreground">Connect in Settings</span>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}

          {/* Refresh Button - Collapsed */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => void handleRefresh()}
                disabled={!canRefresh}
              className={cn(
                  'flex items-center justify-center w-full h-8 rounded-md transition-colors',
                  'border border-white/[0.08] bg-white/[0.03]',
                  canRefresh && 'hover:border-teal-500/30 hover:bg-teal-500/10',
                  'disabled:opacity-40 disabled:cursor-not-allowed'
              )}
            >
                <RefreshCw className={cn(
                  'h-4 w-4',
                  isAnySyncing ? 'animate-spin text-teal-400' : 'text-muted-foreground'
                )} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10} className="glass border-border/60 px-3 py-2">
              <span className="font-medium text-foreground text-sm">
                {isAnySyncing ? 'Syncing...' : isAnyConnected ? 'Refresh all' : 'Connect a source first'}
              </span>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }

  // Render expanded view (horizontal row with staggered appearance)
  return (
    <div className="border-t border-white/[0.06] px-2.5 py-3">
      {/* Header */}
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-semibold">
          Data Sources
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
            <span className="text-[9px] text-muted-foreground/40 cursor-help hover:text-muted-foreground/70 transition-colors">
              {isInitialized ? displayStrings.global : 'Loading...'}
              </span>
            </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8} className="glass border-border/60 px-3 py-2">
            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground text-sm">Sync Status</span>
              <span className="text-[10px] text-muted-foreground">
                {!isInitialized ? 'Loading...' :
                  displayStrings.global === 'Never synced' 
                    ? 'Connect a source to get started' 
                    : `Last sync: ${displayStrings.global}`}
                </span>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>

      {/* Source Items - Horizontal with staggered reveal from right */}
      <div className="flex gap-2">
        {sources.map(({ key, icon: Icon, label, activeColor, activeBg }, index) => {
          const provider = isInitialized ? providers[key] : null;
          const isSyncing = provider?.isSyncing ?? false;
          const isConnected = provider?.status === 'connected';
          const isError = provider?.status === 'error';
          
          // Calculate if this item should be visible
          // visibleCount=1 means only index 2 (Drive) visible
          // visibleCount=2 means index 1,2 (Calendar, Drive) visible
          // visibleCount=3 means all visible
          const isVisible = (sources.length - index) <= visibleCount;

          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 h-9 rounded-lg transition-all duration-200',
                    isConnected && activeBg,
                    isError && 'bg-red-500/10',
                    !isConnected && !isError && 'bg-white/[0.02] hover:bg-white/[0.04]',
                    isSyncing && 'animate-pulse',
                    !isInitialized && 'animate-pulse',
                    // Visibility transition
                    isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'
                  )}
                >
                  <div className="relative">
                    <Icon className={cn(
                      'h-4 w-4',
                      isConnected && !isSyncing && activeColor,
                      isSyncing && 'text-sky-400',
                      isError && 'text-red-400',
                      !isConnected && !isError && !isSyncing && 'text-muted-foreground/40'
                    )} />
                    <div className={cn(
                      'absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-[#0d1117]',
                      isConnected && !isSyncing && 'bg-emerald-500',
                      isSyncing && 'bg-sky-500',
                      isError && 'bg-red-500',
                      !isConnected && !isError && !isSyncing && 'bg-muted-foreground/30'
                    )}>
                      {isSyncing && <RefreshCw className="h-1.5 w-1.5 text-white animate-spin absolute top-0.5 left-0.5" />}
                    </div>
                  </div>
                  <span className={cn(
                    'text-[11px] font-medium',
                    isConnected && 'text-foreground/80',
                    isSyncing && 'text-sky-400',
                    isError && 'text-red-400',
                    !isConnected && !isError && !isSyncing && 'text-muted-foreground/50'
                  )}>
                    {label}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8} className="glass border-border/60 px-3 py-2">
                <div className="flex flex-col gap-1 min-w-[100px]">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground text-sm">{label}</span>
                    <span className={cn(
                      'text-[9px] font-medium px-1.5 py-0.5 rounded-full',
                      isConnected && 'bg-emerald-500/15 text-emerald-400',
                      isSyncing && 'bg-sky-500/15 text-sky-400',
                      isError && 'bg-red-500/15 text-red-400',
                      !isConnected && !isError && !isSyncing && 'bg-muted text-muted-foreground'
                    )}>
                      {isSyncing ? 'Syncing' : isConnected ? 'Active' : isError ? 'Error' : 'Offline'}
                    </span>
                  </div>
                  {isConnected && displayStrings[key] && displayStrings[key] !== 'Never synced' && (
                    <span className="text-[10px] text-muted-foreground">
                      Last sync: {displayStrings[key]}
                    </span>
                  )}
                  {!isConnected && !isError && (
                    <span className="text-[10px] text-muted-foreground">Connect in Settings</span>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Refresh Button - Expanded with delayed appearance */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => void handleRefresh()}
            disabled={!canRefresh}
            className={cn(
              'mt-2 w-full h-8 rounded-lg flex items-center justify-center gap-2 transition-all duration-200',
              'border border-white/[0.08] bg-white/[0.03]',
              canRefresh && 'hover:border-teal-500/30 hover:bg-teal-500/10',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              // Visibility transition
              showRefreshButton ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'
            )}
          >
            <RefreshCw className={cn(
              'h-4 w-4',
              isAnySyncing ? 'animate-spin text-teal-400' : 'text-muted-foreground'
            )} />
            <span className={cn(
              'text-xs font-medium',
              isAnySyncing ? 'text-teal-400' : 'text-muted-foreground'
            )}>
              {isAnySyncing ? 'Syncing...' : 'Refresh Data'}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8} className="glass border-border/60 px-3 py-2">
          <span className="font-medium text-foreground text-sm">
            {isAnySyncing ? 'Syncing all sources...' : isAnyConnected ? 'Refresh all data sources' : 'Connect a source first'}
          </span>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
