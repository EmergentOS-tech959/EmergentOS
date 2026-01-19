'use client';

import { Mail, Calendar, FileText, RefreshCw, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSyncManager, type ProviderKey } from '@/lib/sync-manager';

interface SourceIndicatorsProps {
  isCollapsed: boolean;
}

export function SourceIndicators({ isCollapsed }: SourceIndicatorsProps) {
  const { providers, displayStrings, isInitialized } = useSyncManager();

  const getStatusColor = (status: string, isSyncing: boolean) => {
    if (isSyncing) return 'text-blue-400';
    switch (status) {
      case 'connected': return 'text-teal-400';
      case 'error': return 'text-red-400';
      default: return 'text-gray-500';
    }
  };

  const getStatusDot = (status: string, isSyncing: boolean) => {
    if (isSyncing) return 'bg-blue-400 animate-pulse';
    switch (status) {
      case 'connected': return 'bg-teal-400';
      case 'error': return 'bg-red-400';
      default: return 'bg-gray-600';
    }
  };

  const sources = [
    { key: 'gmail' as ProviderKey, icon: Mail, label: 'Gmail' },
    { key: 'calendar' as ProviderKey, icon: Calendar, label: 'Calendar' },
    { key: 'drive' as ProviderKey, icon: FileText, label: 'Drive' },
  ];

  // CRITICAL: Show loading state until initialized to prevent "Never synced" flash
  if (!isInitialized) {
    return (
      <div className={cn(
        'border-t border-[#30363d] pt-3 px-2',
        isCollapsed ? 'pb-2' : 'pb-3'
      )}>
        {!isCollapsed && (
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
              Sources
            </span>
            <span className="text-[9px] text-gray-600">Loading...</span>
          </div>
        )}
        <div className={cn(
          'flex gap-1',
          isCollapsed ? 'flex-col items-center' : 'flex-row justify-around'
        )}>
          {sources.map(({ key, icon: Icon, label }) => (
            <div
              key={key}
              className={cn(
                'relative flex items-center justify-center p-1.5 rounded-lg',
                isCollapsed ? 'w-10 h-10' : 'flex-1'
              )}
            >
              <Icon className="h-4 w-4 text-gray-600 animate-pulse" />
              {!isCollapsed && (
                <span className="ml-1.5 text-[10px] text-gray-600">{label}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'border-t border-[#30363d] pt-3 px-2',
      isCollapsed ? 'pb-2' : 'pb-3'
    )}>
      {!isCollapsed && (
        <div className="flex items-center justify-between px-2 mb-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
            Sources
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[9px] text-gray-500 cursor-help">
                {displayStrings.global}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs bg-[#21262d] border-[#30363d]">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-white">Data Sources</span>
                <span className="text-gray-400">
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
        'flex gap-1',
        isCollapsed ? 'flex-col items-center' : 'flex-row justify-around'
      )}>
        {sources.map(({ key, icon: Icon, label }) => {
          const provider = providers[key];
          const isSyncing = provider.isSyncing;
          const status = provider.status;
          
          const content = (
            <div
              className={cn(
                'relative flex items-center justify-center p-1.5 rounded-lg transition-all',
                'hover:bg-[#21262d] cursor-default',
                isCollapsed ? 'w-10 h-10' : 'flex-1'
              )}
            >
              <div className="relative">
                <Icon className={cn('h-4 w-4 transition-colors', getStatusColor(status, isSyncing))} />
                {/* Status dot */}
                <span 
                  className={cn(
                    'absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-[#0d1117]',
                    getStatusDot(status, isSyncing)
                  )}
                />
              </div>
              
              {!isCollapsed && (
                <span className={cn(
                  'ml-1.5 text-[10px] transition-colors',
                  status === 'connected' ? 'text-gray-400' : 'text-gray-600'
                )}>
                  {label}
                </span>
              )}

              {/* Syncing overlay */}
              {isSyncing && (
                <RefreshCw className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-blue-400 animate-spin" />
              )}
              
              {/* Error indicator */}
              {status === 'error' && !isSyncing && (
                <AlertCircle className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-red-400" />
              )}
            </div>
          );

          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                {content}
              </TooltipTrigger>
              <TooltipContent side={isCollapsed ? 'right' : 'top'} className="text-xs bg-[#21262d] border-[#30363d]">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-white">{label}</span>
                  <span className={cn(
                    'text-[10px]',
                    status === 'connected' ? 'text-teal-400' : 
                    status === 'error' ? 'text-red-400' : 'text-gray-400'
                  )}>
                    {isSyncing ? 'Syncing...' : 
                     status === 'connected' ? 'Connected' : 
                     status === 'error' ? 'Error' : 'Not connected'}
                  </span>
                  {status === 'connected' && displayStrings[key] && displayStrings[key] !== 'Never synced' && (
                    <span className="text-[10px] text-gray-400">
                      Synced {displayStrings[key]}
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
