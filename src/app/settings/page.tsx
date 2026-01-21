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
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
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
    <Card className={cn(
      'p-5 transition-all duration-200',
      status === 'connected' && 'border-status-green/20',
      status === 'error' && 'border-destructive/20'
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className={cn('h-12 w-12 rounded-xl flex items-center justify-center ring-1 shrink-0', iconBg)}>
            {icon}
          </div>
          <div className="min-w-0">
            <h4 className="font-semibold text-foreground">{name}</h4>
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
            {status === 'connected' && lastSync && (
              <div className="flex items-center gap-2 mt-2.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Last sync: {lastSync}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {status === 'connected' && (
            <div className="flex items-center gap-1.5 text-xs text-status-green bg-status-green/10 px-2.5 py-1.5 rounded-lg font-medium border border-status-green/20">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Connected</span>
            </div>
          )}
          {status === 'connecting' && (
            <div className="flex items-center gap-1.5 text-xs text-status-amber bg-status-amber/10 px-2.5 py-1.5 rounded-lg font-medium border border-status-amber/20">
              <Clock className="h-3.5 w-3.5 animate-spin" />
              <span>Connecting</span>
            </div>
          )}
          {status === 'disconnected' && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary/50 px-2.5 py-1.5 rounded-lg font-medium border border-border">
              <XCircle className="h-3.5 w-3.5" />
              <span>Not connected</span>
            </div>
          )}
          {status === 'error' && (
            <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 px-2.5 py-1.5 rounded-lg font-medium border border-destructive/20">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Error</span>
            </div>
          )}
          {action}
        </div>
      </div>
    </Card>
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
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your account, connections, and preferences
        </p>
      </div>

      <Tabs defaultValue="account" className="space-y-6">
        <TabsList className="bg-secondary/50 border border-border p-1 rounded-xl">
          <TabsTrigger value="account" className="gap-2 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <User className="h-4 w-4" />
            Account
          </TabsTrigger>
          <TabsTrigger value="connections" className="gap-2 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Link2 className="h-4 w-4" />
            Connections
          </TabsTrigger>
          <TabsTrigger value="preferences" className="gap-2 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Bell className="h-4 w-4" />
            Preferences
          </TabsTrigger>
          <TabsTrigger value="data" className="gap-2 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Database className="h-4 w-4" />
            Data
          </TabsTrigger>
        </TabsList>

        {/* Account Tab */}
        <TabsContent value="account" className="space-y-6 animate-fade-in">
          <Card className="p-6">
            <h3 className="text-lg font-semibold text-foreground mb-5">Profile</h3>
            <div className="flex items-center gap-5">
              <Avatar className="h-20 w-20 ring-2 ring-border">
                <AvatarImage src={user?.imageUrl} />
                <AvatarFallback className="text-lg font-semibold bg-primary/10 text-primary">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </AvatarFallback>
              </Avatar>
              <div>
                <h4 className="font-semibold text-foreground text-lg">
                  {user?.fullName || 'User'}
                </h4>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {user?.primaryEmailAddress?.emailAddress}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <div className="flex items-center gap-1.5 text-xs text-status-green bg-status-green/10 px-2.5 py-1.5 rounded-lg font-medium border border-status-green/20">
                    <Shield className="h-3.5 w-3.5" />
                    <span>Verified</span>
                  </div>
                </div>
              </div>
            </div>
            <Separator className="my-6" />
            <p className="text-sm text-muted-foreground">
              Account managed by Clerk. Click your avatar in the header to update profile settings.
            </p>
          </Card>
        </TabsContent>

        {/* Connections Tab */}
        <TabsContent value="connections" className="space-y-4 animate-fade-in">
          <ConnectionCard
            name="Gmail"
            description="Access your email for AI insights and summaries"
            icon={<Mail className="h-6 w-6 text-rose-400" />}
            iconBg="bg-rose-500/15 ring-rose-500/20"
            status={pending.gmail ? 'connecting' : connectionStatus.gmail}
            action={
              connectionStatus.gmail === 'connected' ? (
                flashConnected.gmail ? (
                  <div className="text-xs text-status-green font-semibold bg-status-green/10 px-3 py-2 rounded-lg border border-status-green/20">Connected!</div>
                ) : (
                  <Button variant="outline" size="sm" onClick={disconnectGmail} className="font-medium">
                    Disconnect
                  </Button>
                )
              ) : (
                <ConnectGmail
                  onConnectionStart={() => markConnecting('gmail')}
                  onConnectionSuccess={() => void handleProviderConnected('gmail')}
                  onConnectionError={() => setPending((p) => ({ ...p, gmail: false }))}
                />
              )
            }
          />
          <ConnectionCard
            name="Google Calendar"
            description="Sync your calendar events and detect conflicts"
            icon={<Calendar className="h-6 w-6 text-sky-400" />}
            iconBg="bg-sky-500/15 ring-sky-500/20"
            status={pending.calendar ? 'connecting' : connectionStatus.calendar}
            action={
              connectionStatus.calendar === 'connected' ? (
                flashConnected.calendar ? (
                  <div className="text-xs text-status-green font-semibold bg-status-green/10 px-3 py-2 rounded-lg border border-status-green/20">Connected!</div>
                ) : (
                  <Button variant="outline" size="sm" onClick={disconnectCalendar} className="font-medium">
                    Disconnect
                  </Button>
                )
              ) : (
                <ConnectCalendar
                  onConnectionStart={() => markConnecting('calendar')}
                  onConnectionSuccess={() => void handleProviderConnected('calendar')}
                  onConnectionError={() => setPending((p) => ({ ...p, calendar: false }))}
                />
              )
            }
          />
          <ConnectionCard
            name="Google Drive"
            description="Access your documents for context and analysis"
            icon={<FileText className="h-6 w-6 text-emerald-400" />}
            iconBg="bg-emerald-500/15 ring-emerald-500/20"
            status={pending.drive ? 'connecting' : connectionStatus.drive}
            action={
              connectionStatus.drive === 'connected' ? (
                flashConnected.drive ? (
                  <div className="text-xs text-status-green font-semibold bg-status-green/10 px-3 py-2 rounded-lg border border-status-green/20">Connected!</div>
                ) : (
                  <Button variant="outline" size="sm" onClick={disconnectDrive} className="font-medium">
                    Disconnect
                  </Button>
                )
              ) : (
                <ConnectDrive
                  onConnectionStart={() => markConnecting('drive')}
                  onConnectionSuccess={() => void handleProviderConnected('drive')}
                  onConnectionError={() => setPending((p) => ({ ...p, drive: false }))}
                />
              )
            }
          />
        </TabsContent>

        {/* Preferences Tab */}
        <TabsContent value="preferences" className="space-y-4 animate-fade-in">
          <Card className="p-6 space-y-6">
            <h3 className="text-lg font-semibold text-foreground">Notifications</h3>
            
            <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors">
              <div>
                <Label htmlFor="daily-briefing" className="text-foreground font-medium">Daily Briefing</Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Receive your AI briefing every morning
                </p>
              </div>
              <Switch id="daily-briefing" defaultChecked />
            </div>
            
            <Separator />
            
            <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors">
              <div>
                <Label htmlFor="conflict-alerts" className="text-foreground font-medium">Calendar Conflict Alerts</Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Get notified about scheduling conflicts
                </p>
              </div>
              <Switch id="conflict-alerts" defaultChecked />
            </div>
            
            <Separator />
            
            <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors">
              <div>
                <Label htmlFor="email-summary" className="text-foreground font-medium">Email Summary</Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Weekly digest of important emails
                </p>
              </div>
              <Switch id="email-summary" />
            </div>
          </Card>
        </TabsContent>

        {/* Data Tab */}
        <TabsContent value="data" className="space-y-4 animate-fade-in">
          <Card className="p-6 space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Export Data</h3>
            <p className="text-sm text-muted-foreground">
              Download all your data including emails, calendar events, and AI-generated content.
            </p>
            <Button variant="outline" className="font-medium">Export My Data</Button>
          </Card>
          
          <Card className="p-6 space-y-4 border-destructive/30 bg-destructive/5">
            <h3 className="text-lg font-semibold text-destructive">Danger Zone</h3>
            <p className="text-sm text-muted-foreground">
              Permanently delete all your data. This action cannot be undone.
            </p>
            <Button variant="destructive" className="font-medium">Purge All Data</Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
