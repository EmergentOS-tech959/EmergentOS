'use client';

import React, { createContext, useContext, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useUser } from '@clerk/nextjs';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================

export type ProviderKey = 'gmail' | 'calendar' | 'drive';
export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'syncing';

/**
 * Sync trigger types for change detection
 * - connect: First-time connection → ALWAYS regenerate briefing
 * - disconnect: Source removed → ALWAYS regenerate briefing
 * - manual: User clicked refresh → ALWAYS regenerate briefing
 * - auto: 10-minute auto-sync → ONLY regenerate if data changed
 */
export type SyncTrigger = 'connect' | 'disconnect' | 'manual' | 'auto';

export interface ProviderState {
  status: ConnectionStatus;
  lastSyncAt: string | null;
  isSyncing: boolean;
}

export interface SyncRequest {
  id: string;
  providers: ProviderKey[];
  trigger: SyncTrigger;
  timestamp: number;
  forceRegenerate?: boolean; // Force briefing regeneration regardless of data change
}

// API response with change detection info
interface SyncApiResponse {
  success?: boolean;
  dataChanged?: boolean;
  eventsSynced?: number;
  documentsSynced?: number;
  emailsProcessed?: number;
  syncType?: 'initial' | 'delta';
  warning?: string;
  error?: string;
  // Calendar-specific: analysis result
  analysisResult?: {
    success: boolean;
    eventsAnalyzed?: number;
    conflictsCount?: number;
    totalIssues?: number;
    error?: string;
  };
  // Embedding generation status
  embeddingStatus?: {
    triggered: boolean;
    method?: string;
    embedded?: number;
    skipped?: number;
    error?: string;
    reason?: string;
  };
}

// CRITICAL: Separate display strings for different contexts
interface DisplayStrings {
  global: string;      // When ALL CONNECTED sources synced (for Daily Briefing)
  gmail: string;       // Gmail-specific (or "Not connected")
  calendar: string;    // Calendar-specific (for Today's Schedule) (or "Not connected")
  drive: string;       // Drive-specific (or "Not connected")
}

interface SyncManagerState {
  providers: Record<ProviderKey, ProviderState>;
  globalLastSync: string | null;
  displayStrings: DisplayStrings;
  isAutoSyncEnabled: boolean;
  nextAutoSyncAt: Date | null;
  queueLength: number;
  isSyncing: boolean;
  isInitialized: boolean;
}

interface SyncManagerContextValue extends SyncManagerState {
  syncAll: (options?: { trigger?: SyncTrigger; forceRegenerate?: boolean }) => Promise<void>;
  syncCalendar: (options?: { trigger?: SyncTrigger }) => Promise<void>;
  syncProvider: (provider: ProviderKey, options?: { trigger?: SyncTrigger }) => Promise<void>;
  refreshConnections: () => Promise<void>;
  onProviderConnected: (provider: ProviderKey) => Promise<void>;
  onProviderDisconnected: (provider: ProviderKey) => Promise<void>;
}

// ============================================================================
// Constants
// ============================================================================

const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const DEBOUNCE_WINDOW_MS = 2000;
const DISPLAY_UPDATE_INTERVAL_MS = 30000;

const PROVIDER_SYNC_ENDPOINTS: Record<ProviderKey, string> = {
  gmail: '/api/integrations/gmail/sync',
  calendar: '/api/integrations/calendar/sync',
  drive: '/api/integrations/drive/sync',
};

// ============================================================================
// Helper: Format time difference
// ============================================================================

function computeDisplayTime(iso: string | null): string {
  if (!iso) return 'Never synced';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Date(iso).toLocaleDateString();
}

function computeProviderDisplayTime(
  status: ConnectionStatus, 
  lastSyncAt: string | null
): string {
  if (status === 'disconnected') return 'Not connected';
  if (status === 'error') return 'Error';
  if (!lastSyncAt) return 'Never synced';
  return computeDisplayTime(lastSyncAt);
}

// ============================================================================
// Context
// ============================================================================

const SyncManagerContext = createContext<SyncManagerContextValue | null>(null);

export function useSyncManager(): SyncManagerContextValue {
  const ctx = useContext(SyncManagerContext);
  if (!ctx) {
    throw new Error('useSyncManager must be used within SyncManagerProvider');
  }
  return ctx;
}

// ============================================================================
// Provider Component
// ============================================================================

export function SyncManagerProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const userId = user?.id;

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [providers, setProviders] = useState<Record<ProviderKey, ProviderState>>({
    gmail: { status: 'disconnected', lastSyncAt: null, isSyncing: false },
    calendar: { status: 'disconnected', lastSyncAt: null, isSyncing: false },
    drive: { status: 'disconnected', lastSyncAt: null, isSyncing: false },
  });

  const [globalLastSync, setGlobalLastSync] = useState<string | null>(null);
  const [lastAllSync, setLastAllSync] = useState<string | null>(null);
  const [nextAutoSyncAt, setNextAutoSyncAt] = useState<Date | null>(null);
  const [isAutoSyncEnabled] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [displayTick, setDisplayTick] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);

  // FIFO Queue
  const queueRef = useRef<SyncRequest[]>([]);
  const isProcessingRef = useRef(false);
  const [queueLength, setQueueLength] = useState(0);
  
  const providersRef = useRef(providers);
  useEffect(() => {
    providersRef.current = providers;
  }, [providers]);

  const updateProviders = useCallback((updater: (prev: Record<ProviderKey, ProviderState>) => Record<ProviderKey, ProviderState>) => {
    setProviders((prev) => {
      const next = updater(prev);
      providersRef.current = next;
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Compute lastAllSync dynamically
  // -------------------------------------------------------------------------
  const computedLastAllSync = useMemo<string | null>(() => {
    const connectedProviders = (['gmail', 'calendar', 'drive'] as ProviderKey[])
      .filter((p) => providers[p].status === 'connected');
    
    if (connectedProviders.length === 0) return null;
    
    const allHaveSyncTimes = connectedProviders.every((p) => providers[p].lastSyncAt);
    if (!allHaveSyncTimes) return null;
    
    const times = connectedProviders.map((p) => new Date(providers[p].lastSyncAt!).getTime());
    const oldestTime = Math.min(...times);
    
    if (lastAllSync && new Date(lastAllSync).getTime() > oldestTime) {
      return lastAllSync;
    }
    
    return new Date(oldestTime).toISOString();
  }, [providers, lastAllSync]);

  // -------------------------------------------------------------------------
  // Display strings
  // -------------------------------------------------------------------------
  const displayStrings = useMemo<DisplayStrings>(() => {
    return {
      global: computeDisplayTime(computedLastAllSync),
      gmail: computeProviderDisplayTime(providers.gmail.status, providers.gmail.lastSyncAt),
      calendar: computeProviderDisplayTime(providers.calendar.status, providers.calendar.lastSyncAt),
      drive: computeProviderDisplayTime(providers.drive.status, providers.drive.lastSyncAt),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, computedLastAllSync, displayTick]);

  useEffect(() => {
    const interval = setInterval(() => {
      setDisplayTick((t) => t + 1);
    }, DISPLAY_UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // -------------------------------------------------------------------------
  // Fetch connection statuses
  // -------------------------------------------------------------------------
  
  const fetchConnections = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/connections', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      
      if (!res.ok || !body.connections) return;

      const currentProviders = providersRef.current;
      
      const gmailData = body.connections.gmail;
      const calendarData = body.connections.calendar;
      const driveData = body.connections.drive;
      
      const newProviders: Record<ProviderKey, ProviderState> = {
        gmail: { 
          status: gmailData?.status || 'disconnected',
          lastSyncAt: gmailData?.lastSyncAt || null,
          isSyncing: currentProviders.gmail.isSyncing,
        },
        calendar: { 
          status: calendarData?.status || 'disconnected',
          lastSyncAt: calendarData?.lastSyncAt || null,
          isSyncing: currentProviders.calendar.isSyncing,
        },
        drive: { 
          status: driveData?.status || 'disconnected',
          lastSyncAt: driveData?.lastSyncAt || null,
          isSyncing: currentProviders.drive.isSyncing,
        },
      };

      updateProviders(() => newProviders);
      setIsInitialized(true);

      const connectedWithSync = (['gmail', 'calendar', 'drive'] as ProviderKey[])
        .filter((p) => newProviders[p].status === 'connected' && newProviders[p].lastSyncAt);
      
      const times = connectedWithSync.map((p) => new Date(newProviders[p].lastSyncAt!).getTime());
      
      if (times.length > 0) {
        const serverMaxTime = new Date(Math.max(...times)).toISOString();
        setGlobalLastSync((currentTime) => {
          if (!currentTime) return serverMaxTime;
          return new Date(serverMaxTime) >= new Date(currentTime) ? serverMaxTime : currentTime;
        });
        
        const allConnected = (['gmail', 'calendar', 'drive'] as ProviderKey[])
          .filter((p) => newProviders[p].status === 'connected');
        
        const allHaveSyncTimes = allConnected.every((p) => newProviders[p].lastSyncAt);
        
        if (allHaveSyncTimes && allConnected.length > 0) {
          const oldestSyncTime = new Date(Math.min(...times)).toISOString();
          setLastAllSync((current) => {
            if (!current) return oldestSyncTime;
            return new Date(oldestSyncTime) >= new Date(current) ? oldestSyncTime : current;
          });
        }
      }
    } catch {
      // Best-effort
    }
  }, [userId, updateProviders]);

  // -------------------------------------------------------------------------
  // FIFO Queue Processing with Change Detection
  // -------------------------------------------------------------------------

  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || queueRef.current.length === 0) return;
    
    isProcessingRef.current = true;
    setIsSyncing(true);
    
    while (queueRef.current.length > 0) {
      const request = queueRef.current.shift()!;
      setQueueLength(queueRef.current.length);

      // Deduplicate
      const now = Date.now();
      const hasDuplicate = queueRef.current.some(
        (r) =>
          r.providers.length === request.providers.length &&
          r.providers.every((p) => request.providers.includes(p)) &&
          now - r.timestamp < DEBOUNCE_WINDOW_MS
      );
      
      if (hasDuplicate) continue;

      const currentProviders = providersRef.current;
      const connectedProviders = request.providers.filter(
        (p) => currentProviders[p].status === 'connected'
      );
      
      if (connectedProviders.length === 0) continue;

      // Mark providers as syncing
      updateProviders((prev) => {
        const next = { ...prev };
        for (const p of connectedProviders) {
          next[p] = { ...next[p], isSyncing: true };
        }
        return next;
      });

      // Execute sync and collect results
      const syncPromises = connectedProviders.map(async (provider) => {
        try {
          const endpoint = PROVIDER_SYNC_ENDPOINTS[provider];
          // Pass trigger type to API route so Inngest knows if this is auto/manual/connect
          const res = await fetch(endpoint, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trigger: request.trigger }),
          });
          const body: SyncApiResponse = await res.json().catch(() => ({}));
          const dataChanged = body.dataChanged ?? (
            (body.eventsSynced ?? 0) > 0 ||
            (body.documentsSynced ?? 0) > 0 ||
            (body.emailsProcessed ?? 0) > 0
          );
          
          // Log individual provider sync result
          const count = body.eventsSynced ?? body.documentsSynced ?? body.emailsProcessed ?? 0;
          console.log(`[SyncManager] ${provider} sync: ${body.syncType || 'sync'}, ${count} items, dataChanged: ${dataChanged}`);
          
          // Log embedding status if present
          if (body.embeddingStatus) {
            const es = body.embeddingStatus;
            if (es.triggered) {
              if (es.method === 'inngest') {
                console.log(`[SyncManager] ${provider} embeddings: sent to Inngest (background processing)`);
              } else if (es.method === 'direct') {
                if (es.error) {
                  console.error(`[SyncManager] ${provider} embeddings FAILED: ${es.error}`);
                } else {
                  console.log(`[SyncManager] ${provider} embeddings: embedded=${es.embedded}, skipped=${es.skipped}`);
                }
              }
            } else {
              console.warn(`[SyncManager] ${provider} embeddings SKIPPED: ${es.reason}`);
            }
          }
          
          return { 
            provider, 
            success: res.ok, 
            body,
            dataChanged,
          };
        } catch (err) {
          console.error(`[SyncManager] ${provider} sync failed:`, err);
          return { provider, success: false, body: null, dataChanged: false };
        }
      });

      const results = await Promise.allSettled(syncPromises);

      const newSyncTime = new Date().toISOString();
      
      // Track which providers succeeded and if any data changed
      const successfulProviders: ProviderKey[] = [];
      let anyDataChanged = false;
      let calendarDataChanged = false;
      
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          successfulProviders.push(result.value.provider);
          if (result.value.dataChanged) {
            anyDataChanged = true;
            if (result.value.provider === 'calendar') {
              calendarDataChanged = true;
            }
          }
        }
      }
      
      // Log calendar analysis result (runs automatically in calendar sync when data changes)
      const calendarResult = results.find(r => r.status === 'fulfilled' && r.value.provider === 'calendar');
      if (calendarResult && calendarResult.status === 'fulfilled' && calendarResult.value.body?.analysisResult) {
        const analysis = calendarResult.value.body.analysisResult;
        console.log(`[SyncManager] Calendar analysis result:`, analysis);
      } else if (successfulProviders.includes('calendar')) {
        if (calendarDataChanged) {
          console.log(`[SyncManager] Calendar analysis triggered (data changed)`);
        } else {
          console.log(`[SyncManager] Calendar analysis skipped (no new events)`);
        }
      }
      
      updateProviders((prev) => {
        const next = { ...prev };
        for (const result of results) {
          if (result.status === 'fulfilled') {
            const p = result.value.provider;
            const success = result.value.success;
            next[p] = { 
              ...next[p], 
              isSyncing: false, 
              lastSyncAt: success ? newSyncTime : next[p].lastSyncAt 
            };
          }
        }
        return next;
      });

      if (successfulProviders.length > 0) {
        setGlobalLastSync(newSyncTime);
        
        const allConnected = (['gmail', 'calendar', 'drive'] as ProviderKey[])
          .filter((p) => currentProviders[p].status === 'connected');
        
        if (request.providers.length === 3 || 
            (allConnected.length > 0 && allConnected.every(p => successfulProviders.includes(p)))) {
          setLastAllSync(newSyncTime);
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // CHANGE DETECTION: Decide whether to regenerate briefing
      // ═══════════════════════════════════════════════════════════════════════
      
      const shouldRegenerateBriefing = (() => {
        // Force regenerate always wins
        if (request.forceRegenerate) return true;
        
        switch (request.trigger) {
          case 'connect':
            return true; // Always - new source connected
          case 'disconnect':
            return true; // Always - source removed
          case 'manual':
            return true; // Always - user explicitly requested refresh
          case 'auto':
            return anyDataChanged; // ONLY if data actually changed
          default:
            return true;
        }
      })();
      
      console.log(`[SyncManager] Trigger: ${request.trigger}, DataChanged: ${anyDataChanged}, RegenerateBriefing: ${shouldRegenerateBriefing}`);

      // Regenerate briefing if needed
      let briefingSuccess = false;
      if (successfulProviders.length > 0 && shouldRegenerateBriefing) {
        try {
          console.log(`[SyncManager] Regenerating briefing after sync of: ${successfulProviders.join(', ')}`);
          const res = await fetch('/api/ai/briefing/generate', { method: 'POST' });
          const data = await res.json().catch(() => ({})) as { success?: boolean; error?: string; warning?: string };
          console.log(`[SyncManager] Briefing regeneration result:`, data);
          
          if (!res.ok || data.error) {
            console.error(`[SyncManager] Briefing API error:`, data.error || `HTTP ${res.status}`);
            // Only show toast for manual triggers (don't spam on auto-sync)
            if (request.trigger === 'manual') {
              toast.warning('Briefing may be outdated', {
                description: 'AI service is busy. Try refreshing again in a moment.',
              });
            }
          } else if (data.warning) {
            console.warn(`[SyncManager] Briefing warning:`, data.warning);
            briefingSuccess = true; // Partial success
          } else {
            briefingSuccess = true;
            if (request.trigger === 'manual') {
              toast.success('Data synced', {
                description: 'All sources updated and briefing regenerated.',
              });
            }
          }
        } catch (err) {
          console.error(`[SyncManager] Briefing regeneration failed:`, err);
          if (request.trigger === 'manual') {
            toast.warning('Sync completed but briefing failed', {
              description: 'Data synced but briefing could not be regenerated.',
            });
          }
        }
      } else if (successfulProviders.length > 0) {
        console.log(`[SyncManager] Skipping briefing regeneration (auto-sync with no data changes)`);
        briefingSuccess = true; // No regeneration needed counts as success
        if (request.trigger === 'manual') {
          toast.success('Data synced', {
            description: 'All sources up to date.',
          });
        }
      }

      // Notify other components
      window.dispatchEvent(
        new CustomEvent('eos:connections-updated', {
          detail: { 
            providers: connectedProviders, 
            phase: 'complete', 
            trigger: request.trigger,
            syncTime: newSyncTime,
            syncedProviders: successfulProviders,
            dataChanged: anyDataChanged,
            briefingRegenerated: shouldRegenerateBriefing,
            briefingSuccess,
          },
        })
      );

      if (queueRef.current.length > 0) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    isProcessingRef.current = false;
    setIsSyncing(false);
    setQueueLength(0);
    
    await fetchConnections();
  }, [fetchConnections, updateProviders]);

  const enqueueSync = useCallback(
    (providersToSync: ProviderKey[], trigger: SyncTrigger, forceRegenerate?: boolean) => {
      const currentProviders = providersRef.current;
      const connectedProviders = providersToSync.filter(
        (p) => currentProviders[p].status === 'connected'
      );

      if (connectedProviders.length === 0) {
        if (trigger === 'manual') {
          toast.warning('No connected sources to sync');
        }
        return;
      }

      const request: SyncRequest = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        providers: connectedProviders,
        trigger,
        timestamp: Date.now(),
        forceRegenerate,
      };

      queueRef.current.push(request);
      setQueueLength(queueRef.current.length);
      void processQueue();
    },
    [processQueue]
  );

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  const syncAll = useCallback(async (options?: { trigger?: SyncTrigger; forceRegenerate?: boolean }) => {
    // Default: manual trigger for explicit user action
    const trigger = options?.trigger ?? 'manual';
    const forceRegenerate = options?.forceRegenerate ?? (trigger === 'manual');
    enqueueSync(['gmail', 'calendar', 'drive'], trigger, forceRegenerate);
  }, [enqueueSync]);

  const syncCalendar = useCallback(async (options?: { trigger?: SyncTrigger }) => {
    const trigger = options?.trigger ?? 'manual';
    enqueueSync(['calendar'], trigger);
  }, [enqueueSync]);

  const syncProvider = useCallback(
    async (provider: ProviderKey, options?: { trigger?: SyncTrigger }) => {
      const trigger = options?.trigger ?? 'manual';
      enqueueSync([provider], trigger);
    },
    [enqueueSync]
  );

  const onProviderConnected = useCallback(
    async (provider: ProviderKey) => {
      updateProviders((prev) => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          status: 'connected' as ConnectionStatus,
          isSyncing: true,
        },
      }));
      
      await fetchConnections();
      // Trigger: 'connect' - always regenerates briefing
      enqueueSync([provider], 'connect');
    },
    [fetchConnections, enqueueSync, updateProviders]
  );

  const onProviderDisconnected = useCallback(
    async (provider: ProviderKey) => {
      updateProviders((prev) => ({
        ...prev,
        [provider]: {
          status: 'disconnected' as ConnectionStatus,
          lastSyncAt: null,
          isSyncing: false,
        },
      }));
      
      setLastAllSync(null);
      await fetchConnections();
      
      // NOTE: Briefing regeneration is now handled by the disconnect API routes
      // (gmail/disconnect, calendar/disconnect, drive/disconnect)
      // This prevents duplicate briefing generation
      
      // Notify other components (widgets listen to this to refetch briefing)
      window.dispatchEvent(
        new CustomEvent('eos:provider-disconnected', {
          detail: { provider },
        })
      );
    },
    [fetchConnections, updateProviders]
  );

  // -------------------------------------------------------------------------
  // Wall-Clock Aligned Auto-Sync
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isLoaded || !userId || !isAutoSyncEnabled) return;

    const calculateNextSyncTime = () => {
      const now = new Date();
      const minutes = now.getMinutes();
      const nextMinute = Math.ceil((minutes + 1) / 10) * 10;
      const next = new Date(now);
      next.setMinutes(nextMinute % 60, 0, 0);
      if (nextMinute >= 60) {
        next.setHours(next.getHours() + 1);
      }
      if (next <= now) {
        next.setMinutes(next.getMinutes() + 10);
      }
      return next;
    };

    let timeoutId: NodeJS.Timeout | null = null;
    let intervalId: NodeJS.Timeout | null = null;

    const scheduleNextSync = () => {
      const nextSync = calculateNextSyncTime();
      setNextAutoSyncAt(nextSync);
      const msUntilNext = nextSync.getTime() - Date.now();

      timeoutId = setTimeout(() => {
        // Auto-sync uses 'auto' trigger - only regenerates if data changed
        enqueueSync(['gmail', 'calendar', 'drive'], 'auto');

        intervalId = setInterval(() => {
          const nextTime = new Date(Date.now() + SYNC_INTERVAL_MS);
          setNextAutoSyncAt(nextTime);
          enqueueSync(['gmail', 'calendar', 'drive'], 'auto');
        }, SYNC_INTERVAL_MS);
      }, msUntilNext);
    };

    scheduleNextSync();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [isLoaded, userId, isAutoSyncEnabled, enqueueSync]);

  // -------------------------------------------------------------------------
  // Initial Fetch
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isLoaded || !userId) return;
    const id = setTimeout(() => void fetchConnections(), 100);
    return () => clearTimeout(id);
  }, [isLoaded, userId, fetchConnections]);

  useEffect(() => {
    const handler = () => void fetchConnections();
    window.addEventListener('eos:sync-manager-refresh', handler);
    return () => window.removeEventListener('eos:sync-manager-refresh', handler);
  }, [fetchConnections]);

  useEffect(() => {
    const handleDisconnect = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.provider) {
        onProviderDisconnected(detail.provider as ProviderKey);
      }
    };
    window.addEventListener('eos:provider-disconnect-request', handleDisconnect);
    return () => window.removeEventListener('eos:provider-disconnect-request', handleDisconnect);
  }, [onProviderDisconnected]);

  // -------------------------------------------------------------------------
  // Context Value
  // -------------------------------------------------------------------------

  const contextValue = useMemo<SyncManagerContextValue>(
    () => ({
      providers,
      globalLastSync,
      displayStrings,
      isAutoSyncEnabled,
      nextAutoSyncAt,
      queueLength,
      isSyncing,
      isInitialized,
      syncAll,
      syncCalendar,
      syncProvider,
      refreshConnections: fetchConnections,
      onProviderConnected,
      onProviderDisconnected,
    }),
    [
      providers,
      globalLastSync,
      displayStrings,
      isAutoSyncEnabled,
      isInitialized,
      nextAutoSyncAt,
      queueLength,
      isSyncing,
      syncAll,
      syncCalendar,
      syncProvider,
      fetchConnections,
      onProviderConnected,
      onProviderDisconnected,
    ]
  );

  return (
    <SyncManagerContext.Provider value={contextValue}>
      {children}
    </SyncManagerContext.Provider>
  );
}
