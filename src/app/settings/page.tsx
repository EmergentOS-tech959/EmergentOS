'use client';

import { useUser } from '@clerk/nextjs';
import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { 
  User, 
  Link2, 
  Bell, 
  Database,
  Mail,
  Calendar,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  Shield,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';
import { ConnectGmail } from '@/components/ConnectGmail';
import { ConnectCalendar } from '@/components/ConnectCalendar';
import { ConnectDrive } from '@/components/ConnectDrive';
import { useSyncManager, type ProviderKey } from '@/lib/sync-manager';
import { cn } from '@/lib/utils';

interface ConnectionCardProps {
  name: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
  status: 'connected' | 'disconnected' | 'error' | 'connecting';
  lastSync?: string;
  itemCount?: number;
  action: React.ReactNode;
}

function ConnectionCard({
  name,
  description,
  icon,
  iconBg,
  status,
  lastSync,
  action,
}: ConnectionCardProps) {
  return (
    <div className={cn(
      'flex items-center justify-between gap-4 p-4 rounded-lg border bg-secondary/20 hover:bg-secondary/30 transition-colors',
      status === 'connected' ? 'border-border/50' : 'border-border/30'
    )}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center shrink-0', iconBg)}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-sm text-foreground">{name}</h4>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{description}</p>
          {status === 'connected' && lastSync && (
            <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-muted-foreground/70">
              <Clock className="h-3 w-3" />
              <span>Last sync: {lastSync}</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <span className={cn(
          'text-[11px] font-medium flex items-center gap-1 w-24 justify-end',
          status === 'connected' && 'text-emerald-500',
          status === 'connecting' && 'text-amber-500',
          status === 'disconnected' && 'text-muted-foreground',
          status === 'error' && 'text-red-500'
        )}>
          {status === 'connected' && <><CheckCircle2 className="h-3 w-3" />Connected</>}
          {status === 'connecting' && <><Clock className="h-3 w-3 animate-spin" />Connecting...</>}
          {status === 'disconnected' && <><XCircle className="h-3 w-3" />Not connected</>}
          {status === 'error' && <><AlertTriangle className="h-3 w-3" />Error</>}
        </span>
        <div className="w-[130px] flex justify-end">
          {action}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useUser();
  // CRITICAL: Use SyncManager for connection handling - triggers sync on connect
  const { onProviderConnected, onProviderDisconnected } = useSyncManager();
  
  const [connectionStatus, setConnectionStatus] = useState<Record<string, 'connected' | 'disconnected' | 'error'>>({
    gmail: 'disconnected',
    calendar: 'disconnected',
    drive: 'disconnected',
  });
  const [pending, setPending] = useState<Record<string, boolean>>({
    gmail: false,
    calendar: false,
    drive: false,
  });
  const [pendingUntil, setPendingUntil] = useState<Record<string, number | null>>({
    gmail: null,
    calendar: null,
    drive: null,
  });
  const [flashConnected, setFlashConnected] = useState<Record<string, boolean>>({
    gmail: false,
    calendar: false,
    drive: false,
  });

  const refreshConnections = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetch('/api/connections', { method: 'GET', cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as {
        connections?: Record<string, { status?: 'connected' | 'disconnected' | 'error' }>;
        error?: string;
      };
      if (!res.ok) throw new Error(body?.error || 'Failed to load connections');

      const next = { gmail: 'disconnected', calendar: 'disconnected', drive: 'disconnected' } as Record<
        string,
        'connected' | 'disconnected' | 'error'
      >;
      const c = body.connections || {};
      for (const k of Object.keys(next)) {
        const s = c?.[k]?.status;
        if (s === 'connected' || s === 'error' || s === 'disconnected') next[k] = s;
      }
      setConnectionStatus((prev) => {
        // Flash "Connected!" on transition (not-connected -> connected), then revert to normal disconnect button.
        for (const k of Object.keys(next)) {
          if (prev[k] !== 'connected' && next[k] === 'connected') {
            setFlashConnected((f) => ({ ...f, [k]: true }));
            window.setTimeout(() => setFlashConnected((f) => ({ ...f, [k]: false })), 2000);
          }
        }
        // Clear pending if provider is now connected (or errored)
        setPending((p) => ({
          gmail: next.gmail === 'connected' || next.gmail === 'error' ? false : p.gmail,
          calendar: next.calendar === 'connected' || next.calendar === 'error' ? false : p.calendar,
          drive: next.drive === 'connected' || next.drive === 'error' ? false : p.drive,
        }));
        setPendingUntil((u) => ({
          gmail: next.gmail === 'connected' || next.gmail === 'error' ? null : u.gmail,
          calendar: next.calendar === 'connected' || next.calendar === 'error' ? null : u.calendar,
          drive: next.drive === 'connected' || next.drive === 'error' ? null : u.drive,
        }));
        return next;
      });
    } catch (e) {
      console.error('Failed to load connections', e);
    }
  }, [user?.id]);

  const markConnecting = useCallback((provider: 'gmail' | 'calendar' | 'drive') => {
    setPending((p) => ({ ...p, [provider]: true }));
    setPendingUntil((u) => ({ ...u, [provider]: Date.now() + 30_000 }));
  }, []);

  // CRITICAL: Handler for when a provider successfully connects
  // This calls onProviderConnected which triggers a sync
  // NOTE: We must wait for the Nango webhook to fire (creates DB row) before syncing
  // If webhook fails, we create the connection directly via a fallback API
  const handleProviderConnected = useCallback(
    async (provider: ProviderKey) => {
      // Poll for connection to appear in DB (webhook might take a few seconds)
      const maxAttempts = 8;
      const pollInterval = 1000; // 1 second
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await refreshConnections();
        
        // Check if connection is now confirmed in DB
        const res = await fetch('/api/connections', { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        const status = body?.connections?.[provider]?.status;
        
        if (status === 'connected') {
          console.log(`Provider ${provider} confirmed in DB after ${attempt + 1} attempts`);
          
          // CRITICAL: Clear pending state BEFORE triggering sync
          setPending((p) => ({ ...p, [provider]: false }));
          setPendingUntil((u) => ({ ...u, [provider]: null }));
          
          // Show brief "Connected!" flash
          setFlashConnected((f) => ({ ...f, [provider]: true }));
          setTimeout(() => setFlashConnected((f) => ({ ...f, [provider]: false })), 2000);
          
          // Connection confirmed - now trigger sync
          await onProviderConnected(provider);
          
          // Final refresh to ensure UI is up to date
          await refreshConnections();
          return;
        }
        
        // Wait before next attempt
        await new Promise((r) => setTimeout(r, pollInterval));
      }
      
      // FALLBACK: Webhook didn't create the connection - create it directly
      // This handles the case where Nango webhook fails to get user details
      console.log(`Provider ${provider} not confirmed by webhook, attempting direct creation...`);
      try {
        const createRes = await fetch('/api/nango/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider }),
        });
        const createBody = await createRes.json().catch(() => ({}));
        
        if (createRes.ok && createBody.success) {
          console.log(`Provider ${provider} created directly via fallback`);
          
          setPending((p) => ({ ...p, [provider]: false }));
          setPendingUntil((u) => ({ ...u, [provider]: null }));
          setFlashConnected((f) => ({ ...f, [provider]: true }));
          setTimeout(() => setFlashConnected((f) => ({ ...f, [provider]: false })), 2000);
          
          await onProviderConnected(provider);
          await refreshConnections();
          return;
        }
      } catch (err) {
        console.error('Fallback connection creation failed:', err);
      }
      
      // If we get here, connection wasn't confirmed and fallback failed
      console.warn(`Provider ${provider} could not be confirmed or created`);
      setPending((p) => ({ ...p, [provider]: false }));
      setPendingUntil((u) => ({ ...u, [provider]: null }));
      toast.warning('Connection is taking longer than expected. Please refresh and try syncing.');
    },
    [refreshConnections, onProviderConnected]
  );

  useEffect(() => {
    if (!user?.id) return;
    const anyPending = pending.gmail || pending.calendar || pending.drive;
    if (!anyPending) return;

    const interval = window.setInterval(() => {
      void refreshConnections();

      const now = Date.now();
      const timedOutProviders: Array<'gmail' | 'calendar' | 'drive'> = [];
      (['gmail', 'calendar', 'drive'] as const).forEach((p) => {
        const until = pendingUntil[p];
        if (pending[p] && typeof until === 'number' && now > until) timedOutProviders.push(p);
      });

      if (timedOutProviders.length > 0) {
        setPending((prev) => {
          const next = { ...prev };
          for (const p of timedOutProviders) next[p] = false;
          return next;
        });
        setPendingUntil((prev) => {
          const next = { ...prev };
          for (const p of timedOutProviders) next[p] = null;
          return next;
        });
        toast.warning('Connection is taking longer than expected', {
          description: 'The OAuth succeeded, but the webhook has not confirmed the connection yet. Please refresh and try again.',
        });
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [pending, pendingUntil, refreshConnections, user?.id]);

  useEffect(() => {
    void refreshConnections();
  }, [refreshConnections]);

  const disconnectCalendar = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/calendar/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to disconnect');
      toast.success('Calendar disconnected');
      // CRITICAL: Notify SyncManager of disconnection (updates state, regenerates briefing)
      await onProviderDisconnected('calendar');
      await refreshConnections();
    } catch (e) {
      console.error(e);
      toast.error('Failed to disconnect calendar');
    }
  }, [refreshConnections, onProviderDisconnected]);

  const disconnectGmail = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/gmail/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to disconnect');
      toast.success('Gmail disconnected');
      // CRITICAL: Notify SyncManager of disconnection (updates state, regenerates briefing)
      await onProviderDisconnected('gmail');
      await refreshConnections();
    } catch (e) {
      console.error(e);
      toast.error('Failed to disconnect Gmail');
    }
  }, [refreshConnections, onProviderDisconnected]);

  const disconnectDrive = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/drive/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to disconnect');
      toast.success('Drive disconnected');
      // CRITICAL: Notify SyncManager of disconnection (updates state, regenerates briefing)
      await onProviderDisconnected('drive');
      await refreshConnections();
    } catch (e) {
      console.error(e);
      toast.error('Failed to disconnect Drive');
    }
  }, [refreshConnections, onProviderDisconnected]);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your account, connections, and preferences
        </p>
      </div>

      <Tabs defaultValue="connections" className="space-y-6">
        <TabsList className="w-full justify-start bg-transparent border-b border-border rounded-none p-0 h-auto gap-0">
          <TabsTrigger 
            value="account" 
            className="gap-1.5 px-4 py-2.5 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none text-muted-foreground data-[state=active]:text-foreground hover:text-foreground transition-colors"
          >
            <User className="h-4 w-4" />
            Account
          </TabsTrigger>
          <TabsTrigger 
            value="connections" 
            className="gap-1.5 px-4 py-2.5 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none text-muted-foreground data-[state=active]:text-foreground hover:text-foreground transition-colors"
          >
            <Link2 className="h-4 w-4" />
            Connections
          </TabsTrigger>
          <TabsTrigger 
            value="preferences" 
            className="gap-1.5 px-4 py-2.5 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none text-muted-foreground data-[state=active]:text-foreground hover:text-foreground transition-colors"
          >
            <Bell className="h-4 w-4" />
            Preferences
          </TabsTrigger>
          <TabsTrigger 
            value="data" 
            className="gap-1.5 px-4 py-2.5 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none text-muted-foreground data-[state=active]:text-foreground hover:text-foreground transition-colors"
          >
            <Database className="h-4 w-4" />
            Data
          </TabsTrigger>
        </TabsList>

        {/* Account Tab */}
        <TabsContent value="account" className="space-y-5 pt-6">
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Profile</h3>
            <div className="p-4 rounded-lg border border-border/30 bg-secondary/20">
            <div className="flex items-center gap-4">
                <Avatar className="h-14 w-14">
                <AvatarImage src={user?.imageUrl} />
                  <AvatarFallback className="text-sm font-medium bg-primary/10 text-primary">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </AvatarFallback>
              </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-sm text-foreground">
                  {user?.fullName || 'User'}
                </h4>
                    <span className="text-[10px] text-emerald-500 font-medium flex items-center gap-0.5">
                      <Shield className="h-3 w-3" />
                      Verified
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                  {user?.primaryEmailAddress?.emailAddress}
                </p>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              Account managed by Clerk. Click your avatar in the header to update profile settings.
            </p>
          </div>
        </TabsContent>

        {/* Connections Tab */}
        <TabsContent value="connections" className="space-y-5 pt-6">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">Google Workspace</h3>
            <div className="space-y-2">
              <ConnectionCard
                name="Gmail"
                description="Access your email for AI insights and summaries"
                icon={<Mail className="h-5 w-5 text-rose-400" />}
                iconBg="bg-rose-500/10"
                status={pending.gmail ? 'connecting' : connectionStatus.gmail}
                action={
                  connectionStatus.gmail === 'connected' ? (
                    flashConnected.gmail ? (
                      <span className="text-xs text-emerald-500 font-semibold">Connected!</span>
                    ) : (
                      <Button variant="outline" size="sm" onClick={disconnectGmail} className="h-8 w-full text-xs">
                        Disconnect
                      </Button>
                    )
                  ) : (
                    <ConnectGmail
                      onConnectionStart={() => markConnecting('gmail')}
                      onConnectionSuccess={() => void handleProviderConnected('gmail')}
                      onConnectionError={() => setPending((p) => ({ ...p, gmail: false }))}
                      buttonVariant="default"
                      buttonSize="sm"
                      showIcon={false}
                      label="Connect"
                      className="h-8 w-full text-xs bg-teal-500 hover:bg-teal-600 text-white"
                    />
                  )
                }
              />
              <ConnectionCard
                name="Google Calendar"
                description="Sync your calendar events and detect conflicts"
                icon={<Calendar className="h-5 w-5 text-sky-400" />}
                iconBg="bg-sky-500/10"
                status={pending.calendar ? 'connecting' : connectionStatus.calendar}
                action={
                  connectionStatus.calendar === 'connected' ? (
                    flashConnected.calendar ? (
                      <span className="text-xs text-emerald-500 font-semibold">Connected!</span>
                    ) : (
                      <Button variant="outline" size="sm" onClick={disconnectCalendar} className="h-8 w-full text-xs">
                        Disconnect
                      </Button>
                    )
                  ) : (
                    <ConnectCalendar
                      onConnectionStart={() => markConnecting('calendar')}
                      onConnectionSuccess={() => void handleProviderConnected('calendar')}
                      onConnectionError={() => setPending((p) => ({ ...p, calendar: false }))}
                      buttonVariant="default"
                      buttonSize="sm"
                      showIcon={false}
                      label="Connect"
                      className="h-8 w-full text-xs bg-teal-500 hover:bg-teal-600 text-white"
                    />
                  )
                }
              />
              <ConnectionCard
                name="Google Drive"
                description="Access your documents for context and analysis"
                icon={<FileText className="h-5 w-5 text-emerald-400" />}
                iconBg="bg-emerald-500/10"
                status={pending.drive ? 'connecting' : connectionStatus.drive}
                action={
                  connectionStatus.drive === 'connected' ? (
                    flashConnected.drive ? (
                      <span className="text-xs text-emerald-500 font-semibold">Connected!</span>
                    ) : (
                      <Button variant="outline" size="sm" onClick={disconnectDrive} className="h-8 w-full text-xs">
                        Disconnect
                      </Button>
                    )
                  ) : (
                    <ConnectDrive
                      onConnectionStart={() => markConnecting('drive')}
                      onConnectionSuccess={() => void handleProviderConnected('drive')}
                      onConnectionError={() => setPending((p) => ({ ...p, drive: false }))}
                      buttonVariant="default"
                      buttonSize="sm"
                      showIcon={false}
                      label="Connect"
                      className="h-8 w-full text-xs bg-teal-500 hover:bg-teal-600 text-white"
                    />
                  )
                }
              />
            </div>
          </div>
        </TabsContent>

        {/* Preferences Tab */}
        <TabsContent value="preferences" className="space-y-5 pt-6">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">Notifications</h3>
            <div className="rounded-lg border border-border/30 divide-y divide-border/30">
              <div className="flex items-center justify-between p-4 hover:bg-secondary/20 transition-colors">
              <div>
                  <Label htmlFor="daily-briefing" className="text-sm font-medium text-foreground cursor-pointer">Daily Briefing</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                  Receive your AI briefing every morning
                </p>
              </div>
              <Switch id="daily-briefing" defaultChecked />
            </div>
            
              <div className="flex items-center justify-between p-4 hover:bg-secondary/20 transition-colors">
              <div>
                  <Label htmlFor="conflict-alerts" className="text-sm font-medium text-foreground cursor-pointer">Calendar Conflict Alerts</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                  Get notified about scheduling conflicts
                </p>
              </div>
              <Switch id="conflict-alerts" defaultChecked />
            </div>
            
              <div className="flex items-center justify-between p-4 hover:bg-secondary/20 transition-colors">
              <div>
                  <Label htmlFor="email-summary" className="text-sm font-medium text-foreground cursor-pointer">Email Summary</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                  Weekly digest of important emails
                </p>
              </div>
              <Switch id="email-summary" />
            </div>
            </div>
          </div>
        </TabsContent>

        {/* Data Tab */}
        <TabsContent value="data" className="space-y-5 pt-6">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">Export</h3>
            <div className="p-4 rounded-lg border border-border/30 bg-secondary/20">
              <p className="text-xs text-muted-foreground mb-3">
              Download all your data including emails, calendar events, and AI-generated content.
            </p>
              <Button variant="secondary" size="sm" className="h-8 text-xs">
                Export My Data
              </Button>
            </div>
          </div>
          
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-red-500">Danger Zone</h3>
            <div className="p-4 rounded-lg border border-red-500/20 bg-red-500/5">
              <p className="text-xs text-muted-foreground mb-3">
              Permanently delete all your data. This action cannot be undone.
            </p>
              <Button variant="destructive" size="sm" className="h-8 text-xs">
                Purge All Data
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
