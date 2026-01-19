'use client';

import React, { createContext, useContext, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useUser } from '@clerk/nextjs';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================

export type ProviderKey = 'gmail' | 'calendar' | 'drive';
export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'syncing';

export interface ProviderState {
  status: ConnectionStatus;
  lastSyncAt: string | null;
  isSyncing: boolean;
}

export interface SyncRequest {
  id: string;
  providers: ProviderKey[];
  source: 'auto' | 'manual-briefing' | 'manual-schedule' | 'connection';
  timestamp: number;
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
  displayStrings: DisplayStrings; // CRITICAL: Per-context display strings
  isAutoSyncEnabled: boolean;
  nextAutoSyncAt: Date | null;
  queueLength: number;
  isSyncing: boolean;
  isInitialized: boolean; // CRITICAL: True after first fetchConnections completes
}

interface SyncManagerContextValue extends SyncManagerState {
  syncAll: () => Promise<void>;
  syncCalendar: () => Promise<void>;
  syncProvider: (provider: ProviderKey) => Promise<void>;
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
  gmail: '/api/trigger-sync',
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

// CRITICAL: Format time for a provider, respecting connection status
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

  // Sync timestamps
  const [globalLastSync, setGlobalLastSync] = useState<string | null>(null);
  const [lastAllSync, setLastAllSync] = useState<string | null>(null); // When ALL connected sources synced
  
  const [nextAutoSyncAt, setNextAutoSyncAt] = useState<Date | null>(null);
  const [isAutoSyncEnabled] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Tick counter for periodic display refresh (increments every 30 seconds)
  const [displayTick, setDisplayTick] = useState(0);
  
  // CRITICAL: Track initialization state to prevent UI flicker
  const [isInitialized, setIsInitialized] = useState(false);

  // FIFO Queue
  const queueRef = useRef<SyncRequest[]>([]);
  const isProcessingRef = useRef(false);
  const [queueLength, setQueueLength] = useState(0);
  
  const providersRef = useRef(providers);
  useEffect(() => {
    providersRef.current = providers;
  }, [providers]);

  // Helper to update providers AND ref synchronously
  const updateProviders = useCallback((updater: (prev: Record<ProviderKey, ProviderState>) => Record<ProviderKey, ProviderState>) => {
    setProviders((prev) => {
      const next = updater(prev);
      providersRef.current = next; // CRITICAL: Update ref immediately
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Compute lastAllSync dynamically based on CURRENTLY connected providers
  // This ensures it updates correctly when sources connect/disconnect
  // -------------------------------------------------------------------------
  const computedLastAllSync = useMemo<string | null>(() => {
    const connectedProviders = (['gmail', 'calendar', 'drive'] as ProviderKey[])
      .filter((p) => providers[p].status === 'connected');
    
    // If no providers connected, no "all sync" time
    if (connectedProviders.length === 0) return null;
    
    // Check if ALL connected providers have sync times
    const allHaveSyncTimes = connectedProviders.every((p) => providers[p].lastSyncAt);
    if (!allHaveSyncTimes) return null;
    
    // Use the OLDEST sync time among connected providers
    // This represents when all CURRENTLY connected sources were last synced together
    const times = connectedProviders.map((p) => new Date(providers[p].lastSyncAt!).getTime());
    const oldestTime = Math.min(...times);
    
    // If we have an explicit lastAllSync that is newer, use that instead
    if (lastAllSync && new Date(lastAllSync).getTime() > oldestTime) {
      return lastAllSync;
    }
    
    return new Date(oldestTime).toISOString();
  }, [providers, lastAllSync]);

  // -------------------------------------------------------------------------
  // Display strings - DERIVED using useMemo (no setState in effect)
  // Updates when providers, computedLastAllSync, or displayTick changes
  // CRITICAL: Uses computeProviderDisplayTime for provider-specific strings
  //           to show "Not connected" for disconnected sources
  // -------------------------------------------------------------------------
  const displayStrings = useMemo<DisplayStrings>(() => {
    const result = {
      global: computeDisplayTime(computedLastAllSync),
      gmail: computeProviderDisplayTime(providers.gmail.status, providers.gmail.lastSyncAt),
      calendar: computeProviderDisplayTime(providers.calendar.status, providers.calendar.lastSyncAt),
      drive: computeProviderDisplayTime(providers.drive.status, providers.drive.lastSyncAt),
    };
    
    // DEBUG: Log display strings computation
    console.log('[SyncManager] displayStrings computed:', JSON.stringify({
      computedLastAllSync,
      gmailStatus: providers.gmail.status,
      gmailLastSyncAt: providers.gmail.lastSyncAt,
      calendarStatus: providers.calendar.status,
      calendarLastSyncAt: providers.calendar.lastSyncAt,
      driveStatus: providers.drive.status,
      driveLastSyncAt: providers.drive.lastSyncAt,
      result,
    }, null, 2));
    
    return result;
  },
    // displayTick triggers re-computation every 30s for relative time refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providers, computedLastAllSync, displayTick]
  );

  // Periodic tick every 30 seconds for relative time refresh
  useEffect(() => {
    const interval = setInterval(() => {
      setDisplayTick((t) => t + 1);
    }, DISPLAY_UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // -------------------------------------------------------------------------
  // Fetch connection statuses from server
  // -------------------------------------------------------------------------
  
  const fetchConnections = useCallback(async () => {
    if (!userId) {
      console.log('[SyncManager] fetchConnections: No userId, skipping');
      return;
    }
    try {
      console.log('[SyncManager] fetchConnections: Fetching for userId:', userId);
      const res = await fetch('/api/connections', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      
      // DEBUG: Log full API response
      console.log('[SyncManager] fetchConnections response status:', res.status);
      console.log('[SyncManager] fetchConnections response body:', JSON.stringify(body, null, 2));
      
      if (!res.ok) {
        console.error('[SyncManager] fetchConnections: API returned error', res.status);
        return;
      }
      
      if (!body.connections) {
        console.error('[SyncManager] fetchConnections: No connections in response');
        return;
      }

      const currentProviders = providersRef.current;
      
      // CRITICAL: Extract data with explicit logging
      const gmailData = body.connections.gmail;
      const calendarData = body.connections.calendar;
      const driveData = body.connections.drive;
      
      console.log('[SyncManager] Gmail data:', JSON.stringify(gmailData));
      console.log('[SyncManager] Calendar data:', JSON.stringify(calendarData));
      console.log('[SyncManager] Drive data:', JSON.stringify(driveData));
      
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
      
      console.log('[SyncManager] New providers state:', JSON.stringify(newProviders, null, 2));

      updateProviders(() => newProviders);
      
      // CRITICAL: Mark as initialized after first successful fetch
      setIsInitialized(true);

      // Update globalLastSync to most recent
      const connectedWithSync = (['gmail', 'calendar', 'drive'] as ProviderKey[])
        .filter((p) => newProviders[p].status === 'connected' && newProviders[p].lastSyncAt);
      
      const times = connectedWithSync.map((p) => new Date(newProviders[p].lastSyncAt!).getTime());
      
      if (times.length > 0) {
        const serverMaxTime = new Date(Math.max(...times)).toISOString();
        setGlobalLastSync((currentTime) => {
          if (!currentTime) return serverMaxTime;
          return new Date(serverMaxTime) >= new Date(currentTime) ? serverMaxTime : currentTime;
        });
        
        // CRITICAL: Derive lastAllSync from server data on initial load
        // If ALL connected providers have sync times, use the OLDEST as "last all sync"
        // This ensures the display shows when all sources were last synced together
        const allConnected = (['gmail', 'calendar', 'drive'] as ProviderKey[])
          .filter((p) => newProviders[p].status === 'connected');
        
        const allHaveSyncTimes = allConnected.every((p) => newProviders[p].lastSyncAt);
        
        if (allHaveSyncTimes && allConnected.length > 0) {
          // Use the OLDEST sync time among connected providers as "last all sync"
          // This represents when all sources were last synced together
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
  // FIFO Queue Processing
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

      // Execute sync
      const syncPromises = connectedProviders.map(async (provider) => {
        try {
          const endpoint = PROVIDER_SYNC_ENDPOINTS[provider];
          const res = await fetch(endpoint, { method: 'POST' });
          const body = await res.json().catch(() => ({}));
          return { provider, success: res.ok, body };
        } catch {
          return { provider, success: false, body: null };
        }
      });

      const results = await Promise.allSettled(syncPromises);

      // Generate timestamp
      const newSyncTime = new Date().toISOString();
      
      // Track which providers succeeded
      const successfulProviders: ProviderKey[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          successfulProviders.push(result.value.provider);
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

      // Update global sync time
      if (successfulProviders.length > 0) {
        setGlobalLastSync(newSyncTime);
        
        // CRITICAL: Check if ALL connected providers were synced
        const allConnected = (['gmail', 'calendar', 'drive'] as ProviderKey[])
          .filter((p) => currentProviders[p].status === 'connected');
        
        // If this was a full sync (all providers requested and succeeded)
        if (request.providers.length === 3 || 
            (allConnected.length > 0 && allConnected.every(p => successfulProviders.includes(p)))) {
          setLastAllSync(newSyncTime);
        }
        // NOTE: displayStrings is derived via useMemo, auto-updates when providers/lastAllSync change
      }

      // CRITICAL: Trigger briefing regeneration FIRST (before notifying components)
      // This ensures the briefing is ready when components poll for it
      if (successfulProviders.length > 0) {
        try {
          console.log(`[SyncManager] Regenerating briefing after sync of: ${successfulProviders.join(', ')}`);
          const res = await fetch('/api/ai/briefing/generate', { method: 'POST' });
          const data = await res.json().catch(() => ({}));
          console.log(`[SyncManager] Briefing regeneration result:`, data);
        } catch (err) {
          console.error(`[SyncManager] Briefing regeneration failed:`, err);
        }
      }

      // NOW notify other components (after briefing is regenerated)
      window.dispatchEvent(
        new CustomEvent('eos:connections-updated', {
          detail: { 
            providers: connectedProviders, 
            phase: 'complete', 
            source: request.source,
            syncTime: newSyncTime,
            syncedProviders: successfulProviders,
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
    (providersToSync: ProviderKey[], source: SyncRequest['source']) => {
      const currentProviders = providersRef.current;
      const connectedProviders = providersToSync.filter(
        (p) => currentProviders[p].status === 'connected'
      );

      if (connectedProviders.length === 0) {
        if (source.startsWith('manual')) {
          toast.warning('No connected sources to sync');
        }
        return;
      }

      const request: SyncRequest = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        providers: connectedProviders,
        source,
        timestamp: Date.now(),
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

  const syncAll = useCallback(async () => {
    enqueueSync(['gmail', 'calendar', 'drive'], 'manual-briefing');
  }, [enqueueSync]);

  const syncCalendar = useCallback(async () => {
    // CRITICAL: Only syncs calendar, NOT all sources
    enqueueSync(['calendar'], 'manual-schedule');
  }, [enqueueSync]);

  const syncProvider = useCallback(
    async (provider: ProviderKey) => {
      enqueueSync([provider], 'manual-briefing');
    },
    [enqueueSync]
  );

  const onProviderConnected = useCallback(
    async (provider: ProviderKey) => {
      // CRITICAL: First update local state AND ref to mark provider as connected
      // This ensures enqueueSync won't filter it out due to race condition
      updateProviders((prev) => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          status: 'connected' as ConnectionStatus,
          isSyncing: true, // Show syncing immediately
        },
      }));
      
      // Fetch latest from server (will confirm connected status)
      await fetchConnections();
      
      // Now enqueue sync - provider is definitely marked as connected in providersRef
      enqueueSync([provider], 'connection');
    },
    [fetchConnections, enqueueSync, updateProviders]
  );

  // CRITICAL: Handle provider disconnection
  const onProviderDisconnected = useCallback(
    async (provider: ProviderKey) => {
      // Immediately update local state AND ref to reflect disconnection
      updateProviders((prev) => ({
        ...prev,
        [provider]: {
          status: 'disconnected' as ConnectionStatus,
          lastSyncAt: null, // Clear sync time
          isSyncing: false,
        },
      }));
      
      // When a provider disconnects, lastAllSync becomes stale
      // The computedLastAllSync useMemo will recalculate based on remaining connected providers
      // But we should clear the explicit lastAllSync so it doesn't override the computed value
      setLastAllSync(null);
      
      // Refresh from server to ensure consistency
      await fetchConnections();
      
      // CRITICAL: Regenerate briefing (the disconnect API already deleted the old briefing)
      // If regeneration fails (e.g., rate limit), the UI will show "No briefing" which is better than stale data
      try {
        console.log(`[SyncManager] Regenerating briefing after ${provider} disconnected...`);
        const res = await fetch('/api/ai/briefing/generate', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        console.log(`[SyncManager] Briefing regeneration result:`, data);
        
        if (!res.ok || data.error || data.warning) {
          // Rate limit or other error - briefing was deleted but regeneration failed
          // UI will show "No briefing" which is better than stale data
          console.warn(`[SyncManager] Briefing regeneration issue: ${data.error || data.warning || 'unknown'}`);
          toast.info('Briefing is being regenerated...', { 
            description: 'This may take a moment due to rate limits.' 
          });
        }
      } catch (err) {
        console.error(`[SyncManager] Briefing regeneration failed:`, err);
        toast.info('Briefing will be regenerated shortly');
      }
      
      // NOW notify other components (e.g., to clear data from that source)
      // The briefing should be ready by now
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
        // Auto-sync syncs ALL providers
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

  // Listen for disconnect events from other components (e.g., settings page)
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
