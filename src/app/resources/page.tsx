'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, FileText, RefreshCw, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUser } from '@clerk/nextjs';
import { toast } from 'sonner';
import { ConnectDrive } from '@/components/ConnectDrive';
import { useSyncManager } from '@/lib/sync-manager';

type DriveDocumentRow = {
  id: string;
  document_id: string;
  name: string;
  mime_type: string;
  folder_path: string | null;
  modified_at: string;
  web_view_link: string | null;
};

export default function ResourcesPage() {
  const { user } = useUser();
  // CRITICAL: Use SyncManager for connection handling - triggers sync on connect
  const { onProviderConnected, onProviderDisconnected } = useSyncManager();
  
  const [docs, setDocs] = useState<DriveDocumentRow[]>([]);
  const [foldersById, setFoldersById] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [driveStatus, setDriveStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
  const [driveLastSyncAt, setDriveLastSyncAt] = useState<string | null>(null);
  const [initialSyncState, setInitialSyncState] = useState<'idle' | 'syncing' | 'timed_out'>('idle');
  const [initialSyncTriggered, setInitialSyncTriggered] = useState(false);
  const [drivePending, setDrivePending] = useState(false);
  const [drivePendingUntil, setDrivePendingUntil] = useState<number | null>(null);

  const refreshConnections = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetch('/api/connections', { method: 'GET', cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as {
        connections?: Record<string, { status?: 'connected' | 'disconnected' | 'error'; lastSyncAt?: string | null }>;
      };
      const next = body?.connections?.drive?.status;
      const normalized = next === 'connected' || next === 'error' || next === 'disconnected' ? next : 'disconnected';
      setDriveStatus(normalized);
      const lsa = body?.connections?.drive?.lastSyncAt;
      setDriveLastSyncAt(typeof lsa === 'string' ? lsa : null);
      if (normalized === 'connected' || normalized === 'error') {
        setDrivePending(false);
        setDrivePendingUntil(null);
      }
    } catch {
      // best-effort
    }
  }, [user?.id]);

  const grouped = useMemo(() => {
    const map = new Map<string, DriveDocumentRow[]>();
    for (const d of docs) {
      const key = d.folder_path || 'root';
      map.set(key, [...(map.get(key) || []), d]);
    }
    return Array.from(map.entries());
  }, [docs]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/integrations/drive/documents', { method: 'GET', cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to load documents');
      setDocs(((body?.documents as DriveDocumentRow[]) || []) ?? []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load Drive documents');
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  const syncDrive = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/integrations/drive/sync', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Sync failed');
      if (body?.warning) toast.warning(body.warning);
      else toast.success(`Drive synced (${body.documentsSynced ?? 0} docs)`);
      await refreshConnections();
      await load();
      // Load folder names (best-effort)
      const fRes = await fetch('/api/integrations/drive/folders', { cache: 'no-store' });
      const fBody = await fRes.json().catch(() => ({}));
      const folderMap: Record<string, string> = {};
      for (const f of fBody?.folders || []) {
        folderMap[String(f.id)] = String(f.name);
      }
      setFoldersById(folderMap);
    } catch (e) {
      console.error(e);
      toast.error('Drive sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const disconnectDrive = async () => {
    try {
      const res = await fetch('/api/integrations/drive/disconnect', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Disconnect failed');
      toast.success('Drive disconnected');
      // CRITICAL: Notify SyncManager of disconnection (updates state, regenerates briefing)
      await onProviderDisconnected('drive');
      await refreshConnections();
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to disconnect Drive');
    }
  };

  // CRITICAL: Handler for when Drive successfully connects - triggers sync
  // NOTE: We must wait for the Nango webhook to fire (creates DB row) before syncing
  const handleDriveConnected = useCallback(async () => {
    // Poll for connection to appear in DB (webhook might take a few seconds)
    const maxAttempts = 15;
    const pollInterval = 1000; // 1 second
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await refreshConnections();
      
      // Check if connection is now confirmed in DB
      const res = await fetch('/api/connections', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      const status = body?.connections?.drive?.status;
      
      if (status === 'connected') {
        console.log(`Drive confirmed in DB after ${attempt + 1} attempts`);
        
        // CRITICAL: Clear pending state BEFORE triggering sync
        setDrivePending(false);
        setDrivePendingUntil(null);
        
        // Connection confirmed - now trigger sync
        await onProviderConnected('drive');
        
        // Final refresh to ensure UI is up to date
        await refreshConnections();
        await load();
        return;
      }
      
      // Wait before next attempt
      await new Promise((r) => setTimeout(r, pollInterval));
    }
    
    // If we get here, connection wasn't confirmed in time
    console.warn('Drive not confirmed in DB after 15 attempts');
    setDrivePending(false);
    setDrivePendingUntil(null);
    toast.warning('Connection is taking longer than expected. Please refresh and try syncing.');
  }, [refreshConnections, onProviderConnected, load]);

  useEffect(() => {
    void load();
    void refreshConnections();
  }, [load, refreshConnections]);

  useEffect(() => {
    if (!user?.id) return;
    if (!drivePending) return;

    const interval = window.setInterval(() => {
      void refreshConnections();
      const now = Date.now();
      if (typeof drivePendingUntil === 'number' && now > drivePendingUntil) {
        setDrivePending(false);
        setDrivePendingUntil(null);
        toast.warning('Drive connection is taking longer than expected', {
          description: 'The OAuth succeeded, but the webhook has not confirmed the connection yet. Please refresh and try again.',
        });
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [drivePending, drivePendingUntil, refreshConnections, user?.id]);

  // Option A: after Drive connects, initial sync runs in the background (webhook -> Inngest).
  // If Drive is connected but has never synced, poll until lastSyncAt is set, then auto-refresh documents.
  useEffect(() => {
    if (!user?.id) return;
    if (driveStatus !== 'connected') {
      setInitialSyncState('idle');
      setInitialSyncTriggered(false);
      return;
    }
    if (drivePending) return; // still waiting for webhook to persist the connection
    if (docs.length > 0) {
      setInitialSyncState('idle');
      return;
    }
    if (driveLastSyncAt) {
      setInitialSyncState('idle');
      return;
    }
    if (initialSyncState === 'timed_out') return;

    setInitialSyncState('syncing');
    const startedAt = Date.now();
    let cancelled = false;

    // Guarantee initial data even if the background Inngest job doesn't execute: trigger direct sync once.
    if (!initialSyncTriggered) {
      setInitialSyncTriggered(true);
      void fetch('/api/integrations/drive/sync', { method: 'POST' })
        .then((r) => r.json().catch(() => ({})))
        .then((body) => {
          if (body?.warning) toast.warning(body.warning);
        })
        .catch(() => {
          // non-blocking; polling will still run and timeout if needed
        });
    }

    const interval = window.setInterval(async () => {
      if (cancelled) return;
      await refreshConnections();
      const elapsed = Date.now() - startedAt;
      if (elapsed > 60_000) {
        window.clearInterval(interval);
        if (!cancelled) {
          setInitialSyncState('timed_out');
          toast.warning('Drive initial sync is taking longer than expected', {
            description: 'You can click Sync Drive to force a refresh, or try reconnecting in Settings.',
          });
        }
      }
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [docs.length, driveLastSyncAt, drivePending, driveStatus, initialSyncState, initialSyncTriggered, refreshConnections, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    if (initialSyncState !== 'syncing') return;
    if (!driveLastSyncAt) return;
    setInitialSyncState('idle');
    void load();
  }, [driveLastSyncAt, initialSyncState, load, user?.id]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Resources</h1>
          <p className="text-muted-foreground">
            Your Google Drive context folder
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1 text-xs">
            {drivePending ? (
              <span className="inline-flex items-center gap-1 text-status-amber">
                <Clock className="h-3 w-3" /> Connecting…
              </span>
            ) : driveStatus === 'connected' ? (
              <span className="inline-flex items-center gap-1 text-status-green">
                <CheckCircle2 className="h-3 w-3" /> Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <XCircle className="h-3 w-3" /> Not connected
              </span>
            )}
          </div>
          <Button variant="outline" className="gap-2" onClick={syncDrive} disabled={isSyncing}>
            <RefreshCw className="h-4 w-4" />
            {isSyncing ? 'Syncing…' : 'Sync Drive'}
          </Button>
          {driveStatus === 'connected' ? (
            <Button variant="outline" onClick={disconnectDrive}>
              Disconnect
            </Button>
          ) : (
            <ConnectDrive
              onConnectionStart={() => {
                setDrivePending(true);
                setDrivePendingUntil(Date.now() + 30_000);
              }}
              onConnectionSuccess={() => void handleDriveConnected()}
              onConnectionError={() => {
                setDrivePending(false);
                setDrivePendingUntil(null);
              }}
            />
          )}
        </div>
      </div>

      {/* Content */}
      <Card className="p-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading documents…</div>
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-10">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <FolderOpen className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-2">No documents synced</h2>
            <p className="text-muted-foreground max-w-md mb-6">
              {driveStatus !== 'connected'
                ? 'Connect Drive to start your initial sync automatically.'
                : initialSyncState === 'syncing'
                  ? 'Initial sync is running in the background. Documents will appear automatically.'
                  : initialSyncState === 'timed_out'
                    ? 'Initial sync did not complete. Click Sync Drive to retry.'
                    : 'Sync is automatic after connect. Use Sync Drive to re-sync on demand.'}
            </p>
            <Button className="gap-2" onClick={syncDrive} disabled={isSyncing}>
              <FileText className="h-4 w-4" />
              {isSyncing ? 'Syncing…' : 'Sync Drive'}
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(([folderId, items]) => (
              <div key={folderId} className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {folderId === 'root' ? 'Root' : foldersById[folderId] || `Folder ${folderId}`}
                </div>
                <div className="divide-y divide-border rounded-md border border-border">
                  {items.map((d) => (
                    <div key={d.id} className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{d.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{d.mime_type}</div>
                        </div>
                      </div>
                      {d.web_view_link && (
                        <a
                          className="text-xs text-primary hover:underline"
                          href={d.web_view_link}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
