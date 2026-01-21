'use client';

import { Mail, Calendar, FileText, RefreshCw, AlertCircle, Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSyncManager, type ProviderKey } from '@/lib/sync-manager';

interface SourceIndicatorsProps {
  isCollapsed: boolean;
}

export function SourceIndicators({ isCollapsed }: SourceIndicatorsProps) {
  const { providers, displayStrings, isInitialized } = useSyncManager();

  const sources = [
    { key: 'gmail' as ProviderKey, icon: Mail, label: 'Gmail', activeColor: 'text-rose-400', activeBg: 'bg-rose-500/10' },
    { key: 'calendar' as ProviderKey, icon: Calendar, label: 'Calendar', activeColor: 'text-sky-400', activeBg: 'bg-sky-500/10' },
    { key: 'drive' as ProviderKey, icon: FileText, label: 'Drive', activeColor: 'text-emerald-400', activeBg: 'bg-emerald-500/10' },
  ];

  // Loading state
  if (!isInitialized) {
    return (
      <div className={cn(
        'border-t border-white/[0.06] px-2.5',
        isCollapsed ? 'py-3' : 'py-4'
      )}>
        {!isCollapsed && (
          <div className="flex items-center justify-between px-1.5 mb-3">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-semibold">
              Data Sources
            </span>
            <span className="text-[9px] text-muted-foreground/40 animate-pulse">Loading...</span>
          </div>
        )}
        <div className={cn(
          'flex gap-2',
          isCollapsed ? 'flex-col items-center' : 'flex-row'
        )}>
          {sources.map(({ key, icon: Icon }) => (
            <div
              key={key}
              className={cn(
                'relative flex items-center justify-center rounded-lg bg-white/[0.02] animate-pulse',
                isCollapsed ? 'w-10 h-10' : 'flex-1 py-2.5'
              )}
            >
              <Icon className="h-4 w-4 text-muted-foreground/20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'border-t border-white/[0.06] px-2.5',
      isCollapsed ? 'py-3' : 'py-4'
    )}>
      {!isCollapsed && (
        <div className="flex items-center justify-between px-1.5 mb-3">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-semibold">
            Data Sources
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[9px] text-muted-foreground/40 cursor-help hover:text-muted-foreground/70 transition-colors">
                {displayStrings.global}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8} className="glass border-border/60 px-3 py-2">
              <div className="flex flex-col gap-1">
                <span className="font-medium text-foreground text-sm">Sync Status</span>
                <span className="text-[10px] text-muted-foreground">
                  {displayStrings.global === 'Never synced' 
                    ? 'Connect a source to get started' 
                    : `Last sync: ${displayStrings.global}`}
                </span>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      )}
      
      <div className={cn(
        'flex gap-2',
        isCollapsed ? 'flex-col items-center' : 'flex-row'
      )}>
        {sources.map(({ key, icon: Icon, label, activeColor, activeBg }) => {
          const provider = providers[key];
          const isSyncing = provider.isSyncing;
          const status = provider.status;
          const isConnected = status === 'connected';
          const isError = status === 'error';
          
          const content = (
            <div
              className={cn(
                'group relative flex items-center justify-center rounded-lg transition-all duration-200',
                isCollapsed ? 'w-10 h-10' : 'flex-1 py-2.5 px-2',
                // Connected state
                isConnected && activeBg,
                isConnected && 'hover:brightness-110',
                // Error state
                isError && 'bg-red-500/10',
                // Disconnected state
                !isConnected && !isError && 'bg-white/[0.02] hover:bg-white/[0.04]',
                // Syncing animation
                isSyncing && 'animate-pulse'
              )}
            >
              {/* Icon with status indicator */}
              <div className="relative">
                <Icon className={cn(
                  'h-4 w-4 transition-all duration-200',
                  isConnected && !isSyncing && activeColor,
                  isSyncing && 'text-sky-400',
                  isError && 'text-red-400',
                  !isConnected && !isError && !isSyncing && 'text-muted-foreground/40',
                )} />
                
                {/* Status badge */}
                <div className={cn(
                  'absolute -top-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center',
                  'border border-[#0d1117] transition-all duration-200',
                  isConnected && !isSyncing && 'bg-emerald-500',
                  isSyncing && 'bg-sky-500',
                  isError && 'bg-red-500',
                  !isConnected && !isError && !isSyncing && 'bg-muted-foreground/30',
                )}>
                  {isSyncing ? (
                    <RefreshCw className="h-1.5 w-1.5 text-white animate-spin" />
                  ) : isConnected ? (
                    <Check className="h-1.5 w-1.5 text-white" strokeWidth={3} />
                  ) : isError ? (
                    <AlertCircle className="h-1.5 w-1.5 text-white" />
                  ) : (
                    <Minus className="h-1.5 w-1.5 text-white" strokeWidth={3} />
                  )}
                </div>
              </div>
              
              {/* Label */}
              {!isCollapsed && (
                <span className={cn(
                  'ml-2.5 text-[11px] font-medium transition-colors duration-200',
                  isConnected && 'text-foreground/80',
                  isSyncing && 'text-sky-400',
                  isError && 'text-red-400',
                  !isConnected && !isError && !isSyncing && 'text-muted-foreground/50',
                )}>
                  {label}
                </span>
              )}
            </div>
          );

          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                {content}
              </TooltipTrigger>
              <TooltipContent 
                side={isCollapsed ? 'right' : 'top'} 
                sideOffset={isCollapsed ? 10 : 8} 
                className="glass border-border/60 px-3 py-2"
              >
                <div className="flex flex-col gap-1 min-w-[100px]">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground text-sm">{label}</span>
                  <span className={cn(
                      'text-[9px] font-medium px-1.5 py-0.5 rounded-full',
                      isConnected && 'bg-emerald-500/15 text-emerald-400',
                      isSyncing && 'bg-sky-500/15 text-sky-400',
                      isError && 'bg-red-500/15 text-red-400',
                      !isConnected && !isError && !isSyncing && 'bg-muted text-muted-foreground',
                  )}>
                      {isSyncing ? 'Syncing' : 
                       isConnected ? 'Active' : 
                       isError ? 'Error' : 'Offline'}
                    </span>
                  </div>
                  {isConnected && displayStrings[key] && displayStrings[key] !== 'Never synced' && (
                    <span className="text-[10px] text-muted-foreground">
                      Last sync: {displayStrings[key]}
                  </span>
                  )}
                  {!isConnected && !isError && (
                    <span className="text-[10px] text-muted-foreground">
                      Connect in Settings
                    </span>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
