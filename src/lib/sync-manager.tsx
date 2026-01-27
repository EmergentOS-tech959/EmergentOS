'use client';

/**
 * EmergentOS - SyncManager (Phase 6)
 * 
 * CRITICAL COMPONENT - Implementation per Section 11 of specification.
 * 
 * Features:
 * - Wall-clock aligned 10-minute auto-sync (:00, :10, :20, :30, :40, :50)
 * - DATE BOUNDARY DETECTION: Re-analyze at midnight UTC
 * - EVENT IMMINENCE: Check events starting within 30 minutes
 * - FIFO queue with deduplication (max 3 pending, 2s window)
 * - CustomEvent dispatch for UI updates (eos:connections-updated, eos:imminent-event)
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { useUser } from '@clerk/nextjs';
import { toast } from 'sonner';
import {
  MAX_QUEUE_LENGTH,
  DEDUP_WINDOW_MS,
  IMMINENT_EVENT_THRESHOLD_MINUTES,
} from '@/lib/constants';
import { formatTimeAgo, msUntilNextTenMinuteMark, getCurrentUTCDate } from '@/lib/time';

// ============================================================================
// Types (Per Section 11.1)
// ============================================================================

export type ProviderKey = 'gmail' | 'calendar' | 'drive';
export type ConnectionStatus = 'connected' | 'disconnected' | 'error';
export type SyncTrigger = 'connect' | 'disconnect' | 'manual' | 'auto' | 'date_boundary';

export interface ProviderState {
  status: ConnectionStatus;
  lastSyncAt: string | null;
  isSyncing: boolean;
  error?: string;
}

interface SyncRequest {
  id: string;
  providers: ProviderKey[];
  trigger: SyncTrigger;
  timestamp: number;
}

interface DisplayStrings {
  global: string;
  gmail: string;
  calendar: string;
  drive: string;
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

interface SyncResult {
  success: boolean;
  dataChanged: boolean;
  timeChanged?: boolean;
  itemsSynced?: number;
  error?: string;
}

interface ConnectionsUpdatedDetail {
  providers: ProviderKey[];
  trigger: SyncTrigger;
  dataChanged: boolean;
  briefingRegenerated: boolean;
  phase: 'start' | 'complete' | 'error';
  error?: string;
}

interface ImminentEvent {
  event_id: string;
  title: string;
  start_time: string;
  end_time: string;
  location: string | null;
  minutesUntil: number;
}

interface SyncManagerContextValue extends SyncManagerState {
  syncAll: (options?: { trigger?: SyncTrigger; forceRegenerate?: boolean }) => Promise<void>;
  syncCalendar: (options?: { trigger?: SyncTrigger }) => Promise<void>;
  syncProvider: (provider: ProviderKey, options?: { trigger?: SyncTrigger }) => Promise<void>;
  refreshConnections: () => Promise<void>;
  startProviderSync: (provider: ProviderKey) => void;
  stopProviderSync: (provider: ProviderKey) => void;
  onProviderConnected: (provider: ProviderKey) => Promise<void>;
  onProviderDisconnected: (provider: ProviderKey) => Promise<void>;
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
// Helper Functions
// ============================================================================

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// Module-Level Syncing State (Persists across component remounts)
// ============================================================================
// CRITICAL: This MUST be outside the component to survive remounts during navigation.
// useRef does NOT persist across remounts - it creates a new instance each time.
// This module-level Set is the ONLY reliable way to track syncing state across
// page navigations in Next.js.
const globalSyncingProviders = new Set<ProviderKey>();

// ============================================================================
// SyncManager Provider
// ============================================================================

export function SyncManagerProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const userId = user?.id;

  // ---- State ----
  const [providers, setProviders] = useState<Record<ProviderKey, ProviderState>>({
    gmail: { status: 'disconnected', lastSyncAt: null, isSyncing: false },
    calendar: { status: 'disconnected', lastSyncAt: null, isSyncing: false },
    drive: { status: 'disconnected', lastSyncAt: null, isSyncing: false },
  });
  const [isInitialized, setIsInitialized] = useState(false);
  const [nextAutoSyncAt, setNextAutoSyncAt] = useState<Date | null>(null);
  // Tick counter for real-time timestamp updates (increments every 30 seconds)
  const [tick, setTick] = useState(0);

  // ---- Refs (Per Section 11.2) ----
  const queueRef = useRef<SyncRequest[]>([]);
  const isProcessingRef = useRef(false);
  const lastSyncDateUTCRef = useRef<string | null>(null);
  const notifiedEventIdsRef = useRef<Set<string>>(new Set());
  const autoSyncTimerRef = useRef<NodeJS.Timeout | null>(null);
  // NOTE: Syncing state is tracked in globalSyncingProviders (module-level)
  // NOT in a ref, because refs reset on component remount during navigation.

  // ---- Derived State ----
  const isSyncing = Object.values(providers).some(p => p.isSyncing);
  const queueLength = queueRef.current.length;

  const displayStrings = useMemo<DisplayStrings>(() => {
    // tick is included to force recalculation every 30 seconds for real-time timestamps
    void tick;
    
    const formatProvider = (p: ProviderState): string => {
      if (p.status === 'error') return 'Error';
      if (!p.lastSyncAt) return 'Never synced';
      return formatTimeAgo(p.lastSyncAt);
    };

    // Find most recent sync across all providers
    const allSyncTimes = [providers.gmail, providers.calendar, providers.drive]
      .filter(p => p.status === 'connected' && p.lastSyncAt)
      .map(p => new Date(p.lastSyncAt!).getTime());
    
    const mostRecent = allSyncTimes.length > 0 
      ? new Date(Math.max(...allSyncTimes)).toISOString()
      : null;

    return {
      global: mostRecent ? formatTimeAgo(mostRecent) : 'Not connected',
      gmail: formatProvider(providers.gmail),
      calendar: formatProvider(providers.calendar),
      drive: formatProvider(providers.drive),
    };
  }, [providers, tick]);

  const globalLastSync = useMemo(() => {
    const allSyncTimes = [providers.gmail, providers.calendar, providers.drive]
      .filter(p => p.status === 'connected' && p.lastSyncAt)
      .map(p => new Date(p.lastSyncAt!).getTime());
    
    return allSyncTimes.length > 0 
      ? new Date(Math.max(...allSyncTimes)).toISOString()
      : null;
  }, [providers]);

  const isAnyConnected = Object.values(providers).some(p => p.status === 'connected');

  // ============================================================================
  // Event Dispatch (Per Section 11.4)
  // ============================================================================

  const dispatchConnectionsUpdated = useCallback((detail: ConnectionsUpdatedDetail) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('eos:connections-updated', { detail })
    );
  }, []);

  const dispatchImminentEvent = useCallback((event: ImminentEvent) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('eos:imminent-event', {
        detail: {
          eventId: event.event_id,
          title: event.title,
          startTime: event.start_time,
          minutesUntil: event.minutesUntil,
          location: event.location,
        }
      })
    );

    // Show browser notification if permission granted
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(`Upcoming: ${event.title}`, {
        body: `Starts in ${event.minutesUntil} minutes${event.location ? ` at ${event.location}` : ''}`,
        icon: '/favicon.ico',
        tag: event.event_id,
      });
    }
  }, []);

  // ============================================================================
  // API Calls
  // ============================================================================

  /**
   * Fetch connection status from /api/connections
   * Preserves syncing state from globalSyncingProviders (module-level) to persist across navigation
   */
  const fetchConnections = useCallback(async (): Promise<Record<ProviderKey, ProviderState>> => {
    try {
      const response = await fetch('/api/connections');
      if (!response.ok) {
        throw new Error('Failed to fetch connections');
      }
      const { connections } = await response.json();
      
      // Preserve syncing state from ref (persists across page navigation)
      const isSyncingGmail = globalSyncingProviders.has('gmail');
      const isSyncingCalendar = globalSyncingProviders.has('calendar');
      const isSyncingDrive = globalSyncingProviders.has('drive');
      
      return {
        gmail: {
          status: isSyncingGmail ? 'connected' : (connections.gmail?.status || 'disconnected'),
          lastSyncAt: connections.gmail?.lastSyncAt || null,
          isSyncing: isSyncingGmail,
          error: connections.gmail?.error,
        },
        calendar: {
          status: isSyncingCalendar ? 'connected' : (connections.calendar?.status || 'disconnected'),
          lastSyncAt: connections.calendar?.lastSyncAt || null,
          isSyncing: isSyncingCalendar,
          error: connections.calendar?.error,
        },
        drive: {
          status: isSyncingDrive ? 'connected' : (connections.drive?.status || 'disconnected'),
          lastSyncAt: connections.drive?.lastSyncAt || null,
          isSyncing: isSyncingDrive,
          error: connections.drive?.error,
        },
      };
    } catch (error) {
      console.error('[SyncManager] Failed to fetch connections:', error);
      // Still preserve syncing state even on error
      return {
        gmail: { status: 'disconnected', lastSyncAt: null, isSyncing: globalSyncingProviders.has('gmail') },
        calendar: { status: 'disconnected', lastSyncAt: null, isSyncing: globalSyncingProviders.has('calendar') },
        drive: { status: 'disconnected', lastSyncAt: null, isSyncing: globalSyncingProviders.has('drive') },
      };
    }
  }, []);

  /**
   * Sync a single provider (Per Section 8.1)
   */
  const syncProviderApi = useCallback(async (
    provider: ProviderKey, 
    trigger: SyncTrigger
  ): Promise<SyncResult> => {
    try {
      const response = await fetch(`/api/integrations/${provider}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        return {
          success: false,
          dataChanged: false,
          error: data.error || 'Sync failed',
        };
      }

      return {
        success: true,
        dataChanged: data.dataChanged || false,
        timeChanged: data.timeChanged || false,
        itemsSynced: data.itemsSynced || 0,
      };
    } catch (error) {
      console.error(`[SyncManager] Sync failed for ${provider}:`, error);
      return {
        success: false,
        dataChanged: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }, []);

  /**
   * Check for imminent events (Per Section 11.2)
   */
  const checkImminentEvents = useCallback(async (): Promise<ImminentEvent | null> => {
    try {
      const response = await fetch(
        `/api/calendar/imminent?threshold=${IMMINENT_EVENT_THRESHOLD_MINUTES}`
      );

      if (!response.ok) {
        console.error('[SyncManager] Failed to check imminent events');
        return null;
      }

      const { found, event } = await response.json();
      return found ? event : null;
    } catch (error) {
      console.error('[SyncManager] Imminent events error:', error);
      return null;
    }
  }, []);

  /**
   * Generate briefing
   * CRITICAL: This updates the generated_at timestamp in the database
   */
  const generateBriefing = useCallback(async (): Promise<boolean> => {
    console.log('[SyncManager] Starting briefing generation...');
    try {
      const response = await fetch('/api/ai/briefing/generate', {
        method: 'POST',
      });
      
      if (response.ok) {
        console.log('[SyncManager] Briefing generation succeeded');
        return true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('[SyncManager] Briefing generation failed with status:', response.status, errorData);
        return false;
      }
    } catch (error) {
      console.error('[SyncManager] Briefing generation error:', error);
      return false;
    }
  }, []);

  // ============================================================================
  // Queue Management (Per Section 11.3)
  // ============================================================================

  /**
   * Process the sync queue
   */
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || queueRef.current.length === 0) {
      return;
    }

    isProcessingRef.current = true;
    const request = queueRef.current.shift()!;

    try {
      // Dispatch start event
      dispatchConnectionsUpdated({
        providers: request.providers,
        trigger: request.trigger,
        dataChanged: false,
        briefingRegenerated: false,
        phase: 'start',
      });

      // CRITICAL: Add providers to persistent ref BEFORE setting state
      // This ensures syncing state survives page navigation
      for (const provider of request.providers) {
        globalSyncingProviders.add(provider);
      }

      // Set syncing state for each provider
      setProviders(prev => {
        const updated = { ...prev };
        for (const provider of request.providers) {
          updated[provider] = { ...updated[provider], isSyncing: true };
        }
        return updated;
      });

      // Sync each provider in parallel
      const results = await Promise.all(
        request.providers.map(async (provider) => {
          const result = await syncProviderApi(provider, request.trigger);
          return { provider, ...result };
        })
      );

      // Check for data/time changes
      let anyDataChanged = false;
      let anyTimeChanged = false;
      let calendarTimeChanged = false;

      for (const result of results) {
        if (result.dataChanged) anyDataChanged = true;
        if (result.timeChanged) anyTimeChanged = true;
        // Track calendar-specific timeChanged for analysis coordination
        if (result.provider === 'calendar' && result.timeChanged) {
          calendarTimeChanged = true;
        }
      }

      // CRITICAL: Clear providers from persistent ref BEFORE fetching connections
      // This ensures fetchConnections returns isSyncing: false
      for (const provider of request.providers) {
        globalSyncingProviders.delete(provider);
      }

      // Refresh connection state to get updated lastSyncAt
      const updatedConnections = await fetchConnections();
      setProviders(prev => {
        const updated = { ...prev };
        for (const key of Object.keys(updated) as ProviderKey[]) {
          updated[key] = {
            ...updatedConnections[key],
            isSyncing: false,
          };
        }
        return updated;
      });

      // Determine if briefing should be regenerated (Per Section 4.2)
      // ALWAYS regenerate for: manual, date_boundary, connect triggers
      // OR if any data/time changed during sync
      const shouldRegenerate = 
        request.trigger === 'manual' ||
        request.trigger === 'date_boundary' ||
        request.trigger === 'connect' ||
        anyDataChanged ||
        anyTimeChanged;

      console.log('[SyncManager] Regeneration check:', {
        trigger: request.trigger,
        anyDataChanged,
        anyTimeChanged,
        shouldRegenerate,
      });

      let briefingRegenerated = false;
      if (shouldRegenerate) {
        // CRITICAL FIX: If briefing regenerates but calendar analysis didn't run
        // (because calendar's timeChanged was false but other providers had changes),
        // we need to trigger calendar reanalysis to keep insights in sync with briefing.
        const calendarConnected = request.providers.includes('calendar') || 
          providers.calendar.status === 'connected';
        
        if (calendarConnected && !calendarTimeChanged && (anyDataChanged || anyTimeChanged)) {
          console.log('[SyncManager] Triggering calendar reanalysis (briefing will regenerate but calendar analysis was skipped)');
          try {
            await fetch('/api/calendar/insights', { method: 'POST' });
          } catch (err) {
            console.error('[SyncManager] Calendar reanalysis failed:', err);
          }
        }

        briefingRegenerated = await generateBriefing();
        console.log('[SyncManager] Briefing regeneration result:', briefingRegenerated);
      }

      // Dispatch complete event
      dispatchConnectionsUpdated({
        providers: request.providers,
        trigger: request.trigger,
        dataChanged: anyDataChanged,
        briefingRegenerated,
        phase: 'complete',
      });

      // Show toast for manual syncs
      if (request.trigger === 'manual') {
        if (anyDataChanged) {
          toast.success('Data synced successfully');
        } else {
          toast.info('Already up to date');
        }
      }

    } catch (error) {
      // CRITICAL: Clear providers from persistent ref on error
      for (const provider of request.providers) {
        globalSyncingProviders.delete(provider);
      }

      // Reset syncing state on error
      setProviders(prev => {
        const updated = { ...prev };
        for (const provider of request.providers) {
          updated[provider] = { ...updated[provider], isSyncing: false };
        }
        return updated;
      });

      dispatchConnectionsUpdated({
        providers: request.providers,
        trigger: request.trigger,
        dataChanged: false,
        briefingRegenerated: false,
        phase: 'error',
        error: error instanceof Error ? error.message : 'Sync failed',
      });

      if (request.trigger === 'manual') {
        toast.error('Sync failed', {
          description: error instanceof Error ? error.message : 'Please try again',
        });
      }
    } finally {
      isProcessingRef.current = false;

      // Process next item in queue
      if (queueRef.current.length > 0) {
        processQueue();
      }
    }
  }, [dispatchConnectionsUpdated, fetchConnections, generateBriefing, syncProviderApi]);

  /**
   * Enqueue a sync request (Per Section 11.3)
   */
  const enqueueSync = useCallback(async (
    requestedProviders: ProviderKey[],
    trigger: SyncTrigger
  ): Promise<void> => {
    // 1. Filter to only CONNECTED providers
    const connected = requestedProviders.filter(
      p => providers[p].status === 'connected'
    );

    if (connected.length === 0) {
      if (trigger === 'manual') {
        toast.warning('No connected sources to sync');
      }
      return;
    }

    // 2. Check queue limit
    if (queueRef.current.length >= MAX_QUEUE_LENGTH) {
      if (trigger === 'manual') {
        toast.warning('Please wait, sync already in progress');
      }
      return;
    }

    // 3. Deduplicate (same providers within 2 seconds)
    const sortedProviders = [...connected].sort();
    const isDuplicate = queueRef.current.some(req => {
      const reqProviders = [...req.providers].sort();
      return (
        arraysEqual(reqProviders, sortedProviders) &&
        Date.now() - req.timestamp < DEDUP_WINDOW_MS
      );
    });

    if (isDuplicate) {
      console.log('[SyncManager] Duplicate request ignored');
      return;
    }

    // 4. Add to queue
    queueRef.current.push({
      id: generateId(),
      providers: connected,
      trigger,
      timestamp: Date.now(),
    });

    // 5. Process queue
    processQueue();
  }, [providers, processQueue]);

  // ============================================================================
  // Auto-Sync Implementation (Per Section 11.2)
  // ============================================================================

  const setupAutoSync = useCallback(() => {
    // Clear any existing timer
    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current);
    }

    if (!isAnyConnected) {
      setNextAutoSyncAt(null);
      return;
    }

    const tick = async () => {
      const now = new Date();
      const todayUTC = getCurrentUTCDate();

      console.log('[SyncManager] Auto-sync tick at', now.toISOString());

      // 1. Check date boundary (midnight UTC crossing)
      if (lastSyncDateUTCRef.current && todayUTC !== lastSyncDateUTCRef.current) {
        console.log('[SyncManager] Date boundary crossed, triggering full re-analysis');
        await enqueueSync(['gmail', 'calendar', 'drive'], 'date_boundary');
        lastSyncDateUTCRef.current = todayUTC;
        
        // Schedule next tick
        const msUntilNext = msUntilNextTenMinuteMark();
        setNextAutoSyncAt(new Date(Date.now() + msUntilNext));
        autoSyncTimerRef.current = setTimeout(tick, msUntilNext);
        return;
      }

      // 2. Check imminent events (30 minutes threshold)
      // Only check if calendar is connected
      if (providers.calendar.status === 'connected') {
        const imminentEvent = await checkImminentEvents();
        if (imminentEvent && !notifiedEventIdsRef.current.has(imminentEvent.event_id)) {
          notifiedEventIdsRef.current.add(imminentEvent.event_id);
          dispatchImminentEvent(imminentEvent);
          
          toast.info(`Upcoming: ${imminentEvent.title}`, {
            description: `Starts in ${imminentEvent.minutesUntil} minutes${imminentEvent.location ? ` at ${imminentEvent.location}` : ''}`,
          });
        }
      }

      // 3. Standard auto-sync
      await enqueueSync(['gmail', 'calendar', 'drive'], 'auto');
      lastSyncDateUTCRef.current = todayUTC;

      // Schedule next tick
      const msUntilNext = msUntilNextTenMinuteMark();
      setNextAutoSyncAt(new Date(Date.now() + msUntilNext));
      autoSyncTimerRef.current = setTimeout(tick, msUntilNext);
    };

    // Calculate initial delay to align with wall clock
    const msUntilNext = msUntilNextTenMinuteMark();
    console.log(`[SyncManager] Auto-sync scheduled in ${Math.round(msUntilNext / 1000)}s`);
    setNextAutoSyncAt(new Date(Date.now() + msUntilNext));
    autoSyncTimerRef.current = setTimeout(tick, msUntilNext);
  }, [isAnyConnected, providers.calendar.status, checkImminentEvents, dispatchImminentEvent, enqueueSync]);

  // ============================================================================
  // Public Methods
  // ============================================================================

  const syncAll = useCallback(async (options?: { 
    trigger?: SyncTrigger; 
    forceRegenerate?: boolean;
  }): Promise<void> => {
    const trigger = options?.trigger || 'manual';
    await enqueueSync(['gmail', 'calendar', 'drive'], trigger);
  }, [enqueueSync]);

  const syncCalendar = useCallback(async (options?: { 
    trigger?: SyncTrigger;
  }): Promise<void> => {
    const trigger = options?.trigger || 'manual';
    await enqueueSync(['calendar'], trigger);
  }, [enqueueSync]);

  const syncProvider = useCallback(async (
    provider: ProviderKey, 
    options?: { trigger?: SyncTrigger }
  ): Promise<void> => {
    const trigger = options?.trigger || 'manual';
    await enqueueSync([provider], trigger);
  }, [enqueueSync]);

  const refreshConnections = useCallback(async (): Promise<void> => {
    const connections = await fetchConnections();
    setProviders(connections);
  }, [fetchConnections]);

  /**
   * Immediately mark a provider as syncing (for UI feedback during connection flow)
   * This is called when a Connect component starts its sync, BEFORE the connection is fully confirmed.
   * Uses ref to persist syncing state across page navigations.
   */
  const startProviderSync = useCallback((provider: ProviderKey): void => {
    // Add to ref so state persists across navigation/refreshes
    globalSyncingProviders.add(provider);
    
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        status: 'connected', // Optimistically mark as connected
        isSyncing: true,
      },
    }));
  }, []);

  /**
   * Clear syncing state for a provider (called on error/cancel)
   */
  const stopProviderSync = useCallback((provider: ProviderKey): void => {
    // Remove from ref
    globalSyncingProviders.delete(provider);
    
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        isSyncing: false,
      },
    }));
  }, []);

  const onProviderConnected = useCallback(async (provider: ProviderKey): Promise<void> => {
    // Clear syncing state from ref (sync complete)
    globalSyncingProviders.delete(provider);
    
    // Refresh connections to get updated state (isSyncing will be false since we cleared the ref)
    const connections = await fetchConnections();
    setProviders(connections);
    
    // Dispatch event for other components
    dispatchConnectionsUpdated({
      providers: [provider],
      trigger: 'connect',
      dataChanged: true,
      briefingRegenerated: true,
      phase: 'complete',
    });
  }, [fetchConnections, dispatchConnectionsUpdated]);

  const onProviderDisconnected = useCallback(async (provider: ProviderKey): Promise<void> => {
    // Update local state immediately
    setProviders(prev => ({
      ...prev,
      [provider]: { status: 'disconnected', lastSyncAt: null, isSyncing: false },
    }));

    // CRITICAL: Regenerate briefing after disconnect because data sources changed
    // The briefing should reflect that this provider's data is no longer available
    console.log(`[SyncManager] Provider ${provider} disconnected, regenerating briefing...`);
    const briefingRegenerated = await generateBriefing();
    console.log(`[SyncManager] Briefing regeneration after disconnect: ${briefingRegenerated}`);

    // Dispatch event
    dispatchConnectionsUpdated({
      providers: [provider],
      trigger: 'disconnect',
      dataChanged: true,
      briefingRegenerated,
      phase: 'complete',
    });
  }, [dispatchConnectionsUpdated, generateBriefing]);

  // ============================================================================
  // Effects
  // ============================================================================

  // Initialize: Fetch connections on mount
  useEffect(() => {
    if (!isLoaded || !userId) return;

    const initialize = async () => {
      console.log('[SyncManager] Initializing...');
      const connections = await fetchConnections();
      setProviders(connections);
      lastSyncDateUTCRef.current = getCurrentUTCDate();
      setIsInitialized(true);
      console.log('[SyncManager] Initialized with connections:', connections);
    };

    initialize();
  }, [isLoaded, userId, fetchConnections]);

  // Real-time timestamp updates: increment tick every 30 seconds
  useEffect(() => {
    const intervalId = setInterval(() => {
      setTick(t => t + 1);
    }, 30000); // 30 seconds

    return () => clearInterval(intervalId);
  }, []);

  // Setup auto-sync when providers change
  useEffect(() => {
    if (!isInitialized) return;
    setupAutoSync();

    return () => {
      if (autoSyncTimerRef.current) {
        clearTimeout(autoSyncTimerRef.current);
      }
    };
  }, [isInitialized, isAnyConnected, setupAutoSync]);

  // Listen for external connection updates (from Connect components)
  useEffect(() => {
    const handleConnectionsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<ConnectionsUpdatedDetail>;
      if (customEvent.detail.phase === 'complete') {
        // Refresh connections state
        refreshConnections();
      }
    };

    window.addEventListener('eos:connections-updated', handleConnectionsUpdated);
    return () => {
      window.removeEventListener('eos:connections-updated', handleConnectionsUpdated);
    };
  }, [refreshConnections]);

  // ============================================================================
  // Context Value
  // ============================================================================

  const contextValue = useMemo<SyncManagerContextValue>(
    () => ({
      providers,
      globalLastSync,
      displayStrings,
      isAutoSyncEnabled: isAnyConnected,
      nextAutoSyncAt,
      queueLength,
      isSyncing,
      isInitialized,
      syncAll,
      syncCalendar,
      syncProvider,
      refreshConnections,
      startProviderSync,
      stopProviderSync,
      onProviderConnected,
      onProviderDisconnected,
    }),
    [
      providers,
      globalLastSync,
      displayStrings,
      isAnyConnected,
      nextAutoSyncAt,
      queueLength,
      isSyncing,
      isInitialized,
      syncAll,
      syncCalendar,
      syncProvider,
      refreshConnections,
      startProviderSync,
      stopProviderSync,
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
