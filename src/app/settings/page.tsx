'use client';

/**
 * EmergentOS - Settings Page
 * 
 * Displays connection status from SyncManager and allows
 * connecting/disconnecting providers.
 */

import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
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
  Loader2,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ConnectGmail } from '@/components/ConnectGmail';
import { ConnectCalendar } from '@/components/ConnectCalendar';
import { ConnectDrive } from '@/components/ConnectDrive';
import { cn } from '@/lib/utils';
import { useSyncManager, type ProviderKey } from '@/lib/sync-manager';
import { toast } from 'sonner';
import { formatTimeAgo } from '@/lib/time';

// ============================================================================
// Types
// ============================================================================

type ConnectionStatusType = 'connected' | 'disconnected' | 'error' | 'connecting' | 'disconnecting';

interface ConnectionCardProps {
  name: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
  status: ConnectionStatusType;
  lastSync?: string | null;
  error?: string | null;
  connectAction: React.ReactNode;
  onDisconnect: () => void;
  isDisconnecting: boolean;
}

// ============================================================================
// Connection Card Component
// ============================================================================

function ConnectionCard({
  name,
  description,
  icon,
  iconBg,
  status,
  lastSync,
  error,
  connectAction,
  onDisconnect,
  isDisconnecting,
}: ConnectionCardProps) {
  const isConnected = status === 'connected';
  const isError = status === 'error';
  const isConnecting = status === 'connecting';

  return (
    <div className={cn(
      'flex items-center justify-between gap-4 p-4 rounded-lg border bg-secondary/20 hover:bg-secondary/30 transition-colors',
      isConnected && 'border-emerald-500/30',
      isError && 'border-red-500/30',
      !isConnected && !isError && 'border-border/30'
    )}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={cn(
          'h-10 w-10 rounded-lg flex items-center justify-center shrink-0',
          iconBg,
          isError && 'bg-red-500/10'
        )}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-sm text-foreground">{name}</h4>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{description}</p>
          {isConnected && lastSync && (
            <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-muted-foreground/70">
              <Clock className="h-3 w-3" />
              <span>Last sync: {formatTimeAgo(lastSync)}</span>
            </div>
          )}
          {isError && error && (
            <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-red-400">
              <AlertTriangle className="h-3 w-3" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        {/* Status Badge */}
        <span className={cn(
          'text-[11px] font-medium flex items-center gap-1 w-28 justify-end',
          isConnected && 'text-emerald-500',
          isConnecting && 'text-amber-500',
          status === 'disconnected' && 'text-muted-foreground',
          isError && 'text-red-500',
          isDisconnecting && 'text-amber-500'
        )}>
          {isConnected && !isDisconnecting && <><CheckCircle2 className="h-3 w-3" />Connected</>}
          {isConnecting && <><Loader2 className="h-3 w-3 animate-spin" />Connecting...</>}
          {status === 'disconnected' && <><XCircle className="h-3 w-3" />Not connected</>}
          {isError && <><AlertTriangle className="h-3 w-3" />Error</>}
          {isDisconnecting && <><Loader2 className="h-3 w-3 animate-spin" />Disconnecting...</>}
        </span>

        {/* Action Button */}
        <div className="w-[130px] flex justify-end">
          {isConnected || isError ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onDisconnect}
              disabled={isDisconnecting}
              className="h-9 w-full text-xs font-medium border-red-500/20 text-red-400 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30 transition-all shadow-sm"
            >
              {isDisconnecting ? (
                <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Disconnecting</>
              ) : (
                <><Trash2 className="h-3 w-3 mr-1.5" />Disconnect</>
              )}
            </Button>
          ) : (
            connectAction
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Settings Page
// ============================================================================

export default function SettingsPage() {
  const { user } = useUser();
  const router = useRouter();
  const { providers, refreshConnections, onProviderDisconnected, onProviderConnected, startProviderSync } = useSyncManager();
  
  const [disconnecting, setDisconnecting] = useState<Record<ProviderKey, boolean>>({
    gmail: false,
    calendar: false,
    drive: false,
  });
  
  const [onboardingStatus, setOnboardingStatus] = useState<string | null>(null);

  // Fetch onboarding status on mount
  useEffect(() => {
    fetch('/api/onboarding/status')
      .then(res => res.json())
      .then(data => setOnboardingStatus(data.status || 'pending'))
      .catch(() => setOnboardingStatus('pending'));
  }, []);

  // ============================================================================
  // Disconnect Handler
  // ============================================================================

  const handleDisconnect = useCallback(async (provider: ProviderKey) => {
    setDisconnecting(prev => ({ ...prev, [provider]: true }));

    try {
      const response = await fetch(`/api/integrations/${provider}/disconnect`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to disconnect');
      }

      // Update local state
      onProviderDisconnected(provider);
      
      // Dispatch event for other components
      window.dispatchEvent(
        new CustomEvent('eos:connections-updated', {
          detail: {
            providers: [provider],
            trigger: 'disconnect',
            dataChanged: true,
            briefingRegenerated: true,
            phase: 'complete',
          }
        })
      );

      toast.success(`${provider.charAt(0).toUpperCase() + provider.slice(1)} disconnected`, {
        description: 'Your data has been removed.',
      });
    } catch (error) {
      console.error(`[Settings] Disconnect error for ${provider}:`, error);
      toast.error('Failed to disconnect', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setDisconnecting(prev => ({ ...prev, [provider]: false }));
    }
  }, [onProviderDisconnected]);

  // ============================================================================
  // Connection Success Handler
  // ============================================================================

  const handleConnectionSuccess = useCallback(async (provider: ProviderKey) => {
    // Notify sync manager about the new connection to trigger initial sync
    await onProviderConnected(provider);
  }, [onProviderConnected]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your account, connections, and preferences
        </p>
      </div>

      <Tabs defaultValue="account" className="space-y-6">
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
          <h3 className="text-sm font-medium text-foreground">Profile</h3>
          
          {/* Profile and Profile Setup side by side */}
          <div className="p-4 rounded-lg border border-border/30 bg-secondary/20">
            <div className="flex items-center gap-4">
              <Avatar className="h-14 w-14 shrink-0">
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
              
              {/* Profile Setup Status - moved to the right */}
              <div className="shrink-0">
                {onboardingStatus === null && (
                  <div className="h-9 w-32 bg-secondary/50 rounded-md animate-pulse" />
                )}

                {onboardingStatus === 'skipped' && (
                  <Button 
                    onClick={() => router.push('/onboarding')}
                    className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white gap-2 shadow-sm font-medium transition-all hover:shadow-md hover:scale-[1.02]"
                    size="default"
                  >
                    <Sparkles className="h-4 w-4" />
                    Complete Profile
                  </Button>
                )}
                
                {onboardingStatus === 'in_progress' && (
                  <Button 
                    onClick={() => router.push('/onboarding')}
                    className="bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white gap-2 shadow-sm font-medium transition-all hover:shadow-md hover:scale-[1.02]"
                    size="default"
                  >
                    <Sparkles className="h-4 w-4" />
                    Continue Setup
                  </Button>
                )}

                {onboardingStatus === 'pending' && (
                  <Button 
                    onClick={() => router.push('/onboarding')}
                    className="bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700 text-white gap-2 shadow-sm font-medium transition-all hover:shadow-md hover:scale-[1.02]"
                    size="default"
                  >
                    <Sparkles className="h-4 w-4" />
                    Start Onboarding
                  </Button>
                )}
                
                {onboardingStatus === 'completed' && (
                  <div className="flex items-center gap-1.5 text-emerald-500 text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Profile Complete</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <p className="text-[11px] text-muted-foreground/70">
            Account managed by Clerk. Click your avatar in the header to update profile settings.
          </p>
        </TabsContent>

        {/* Connections Tab */}
        <TabsContent value="connections" className="space-y-5 pt-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">Google Workspace</h3>
              <span className="text-[10px] text-muted-foreground">
                {[providers.gmail, providers.calendar, providers.drive].filter(p => p.status === 'connected').length}/3 connected
              </span>
            </div>
            <div className="space-y-2">
              {/* Gmail */}
              <ConnectionCard
                name="Gmail"
                description="Access your email for AI insights and summaries"
                icon={<Mail className={cn(
                  'h-5 w-5',
                  providers.gmail.status === 'connected' ? 'text-rose-400' : 
                  providers.gmail.status === 'error' ? 'text-red-400' : 'text-muted-foreground'
                )} />}
                iconBg="bg-rose-500/10"
                status={providers.gmail.status}
                lastSync={providers.gmail.lastSyncAt}
                error={providers.gmail.error}
                connectAction={
                  <ConnectGmail
                    buttonVariant="default"
                    buttonSize="sm"
                    showIcon={false}
                    label="Connect"
                    className="h-9 w-full text-xs font-medium bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white shadow-sm border-0"
                    onSyncStart={() => startProviderSync('gmail')}
                    onConnectionSuccess={() => handleConnectionSuccess('gmail')}
                  />
                }
                onDisconnect={() => handleDisconnect('gmail')}
                isDisconnecting={disconnecting.gmail}
              />

              {/* Calendar */}
              <ConnectionCard
                name="Google Calendar"
                description="Sync your calendar events and detect conflicts"
                icon={<Calendar className={cn(
                  'h-5 w-5',
                  providers.calendar.status === 'connected' ? 'text-sky-400' : 
                  providers.calendar.status === 'error' ? 'text-red-400' : 'text-muted-foreground'
                )} />}
                iconBg="bg-sky-500/10"
                status={providers.calendar.status}
                lastSync={providers.calendar.lastSyncAt}
                error={providers.calendar.error}
                connectAction={
                  <ConnectCalendar
                    buttonVariant="default"
                    buttonSize="sm"
                    showIcon={false}
                    label="Connect"
                    className="h-9 w-full text-xs font-medium bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white shadow-sm border-0"
                    onSyncStart={() => startProviderSync('calendar')}
                    onConnectionSuccess={() => handleConnectionSuccess('calendar')}
                  />
                }
                onDisconnect={() => handleDisconnect('calendar')}
                isDisconnecting={disconnecting.calendar}
              />

              {/* Drive */}
              <ConnectionCard
                name="Google Drive"
                description="Access your documents for context and analysis"
                icon={<FileText className={cn(
                  'h-5 w-5',
                  providers.drive.status === 'connected' ? 'text-emerald-400' : 
                  providers.drive.status === 'error' ? 'text-red-400' : 'text-muted-foreground'
                )} />}
                iconBg="bg-emerald-500/10"
                status={providers.drive.status}
                lastSync={providers.drive.lastSyncAt}
                error={providers.drive.error}
                connectAction={
                  <ConnectDrive
                    buttonVariant="default"
                    buttonSize="sm"
                    showIcon={false}
                    label="Connect"
                    className="h-9 w-full text-xs font-medium bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-sm border-0"
                    onSyncStart={() => startProviderSync('drive')}
                    onConnectionSuccess={() => handleConnectionSuccess('drive')}
                  />
                }
                onDisconnect={() => handleDisconnect('drive')}
                isDisconnecting={disconnecting.drive}
              />
            </div>
          </div>

          {/* Connection Info */}
          <div className="p-4 rounded-lg border border-border/30 bg-secondary/10">
            <h4 className="text-xs font-medium text-foreground mb-2">About Connections</h4>
            <ul className="text-[11px] text-muted-foreground space-y-1.5">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
                <span>Data is synced securely and stays private</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
                <span>Auto-sync runs every 10 minutes</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
                <span>Disconnect anytime to remove your data</span>
              </li>
            </ul>
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
                    Receive your AI briefing every morning at 6 AM UTC
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
                  <Label htmlFor="imminent-events" className="text-sm font-medium text-foreground cursor-pointer">Imminent Event Alerts</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Notify when events start within 30 minutes
                  </p>
                </div>
                <Switch id="imminent-events" defaultChecked />
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Data Tab */}
        <TabsContent value="data" className="space-y-5 pt-6">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">Data Retention</h3>
            <div className="p-4 rounded-lg border border-border/30 bg-secondary/20">
              <p className="text-xs text-muted-foreground mb-3">
                Your synced data is automatically cleaned up after 30 days. 
                Briefings older than 30 days are also removed.
              </p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
                <Clock className="h-3 w-3" />
                <span>Cleanup runs daily at 3 AM UTC</span>
              </div>
            </div>
          </div>
          
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-red-500">Danger Zone</h3>
            <div className="p-4 rounded-lg border border-red-500/20 bg-red-500/5">
              <p className="text-xs text-muted-foreground mb-3">
                Disconnect all providers to remove all your synced data. 
                This action cannot be undone.
              </p>
              <Button 
                variant="destructive" 
                size="sm" 
                className="h-8 text-xs"
                onClick={() => {
                  const connectedProviders = (['gmail', 'calendar', 'drive'] as ProviderKey[])
                    .filter(p => providers[p].status === 'connected');
                  
                  if (connectedProviders.length === 0) {
                    toast.info('No connections to remove');
                    return;
                  }

                  // Disconnect all providers
                  connectedProviders.forEach(p => handleDisconnect(p));
                }}
                disabled={!Object.values(providers).some(p => p.status === 'connected')}
              >
                Disconnect All &amp; Purge Data
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
