'use client';

import { useUser } from '@clerk/nextjs';
import { useState, useEffect, useCallback } from 'react';
import { Shield, Mail, Calendar, FileText, CheckCircle2, Lock, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConnectGmail } from '@/components/ConnectGmail';
import { supabase } from '@/lib/supabase-client';
import {
  DailyBriefingWidget,
  ScheduleWidget,
  GoalProgressWidget,
  KeyDecisionsWidget
} from '@/components/dashboard';

// Email type from Supabase
interface Email {
  id: string;
  sender: string;
  subject: string;
  received_at: string;
  security_verified: boolean;
}

type SyncStatus = 'disconnected' | 'connecting' | 'fetching' | 'securing' | 'complete' | 'error';

export default function DashboardPage() {
  const { user, isLoaded } = useUser();
  const [status, setStatus] = useState<SyncStatus>('disconnected');
  const [emails, setEmails] = useState<Email[]>([]);

  // Format date for display
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // Extract sender name from email format "Name <email@domain.com>"
  const formatSender = (sender: string) => {
    const match = sender.match(/^([^<]+)/);
    return match ? match[1].trim() : sender;
  };

  // Fetch current sync status from Supabase
  const fetchStatus = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('sync_status')
      .select('status, updated_at')
      .eq('user_id', userId)
      .maybeSingle<{ status: string; updated_at: string }>();
    
    if (error) {
      console.error('Error fetching status:', error);
      return;
    }
    
    if (data && data.status) {
      // If status is stuck on 'fetching' or 'securing' for more than 60 seconds,
      // reset to 'disconnected' (the process likely failed)
      if (data.status === 'fetching' || data.status === 'securing') {
        const updatedAt = new Date(data.updated_at).getTime();
        const now = Date.now();
        const secondsElapsed = (now - updatedAt) / 1000;
        
        if (secondsElapsed > 60) {
          console.log('Stale status detected, resetting to disconnected');
          setStatus('disconnected');
          // Clean up stale data
          await supabase.from('sync_status').delete().eq('user_id', userId);
          return;
        }
      }
      
      setStatus(data.status as SyncStatus);
    } else {
      setStatus('disconnected');
    }
  }, []);

  // Fetch emails from Supabase
  const fetchEmails = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('emails')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (error) {
      console.error('Error fetching emails:', error);
      return;
    }
    
    if (data) {
      setEmails(data as Email[]);
    }
  }, []);

  // Set up initial fetch and realtime subscription
  useEffect(() => {
    if (!user?.id) return;

    const userId = user.id;
    let isMounted = true;

    // Initial fetch - wrapped in async IIFE with mount check
    const initFetch = async () => {
      if (!isMounted) return;
      await fetchStatus(userId);
      if (!isMounted) return;
      await fetchEmails(userId);
    };
    
    // Schedule the fetch on next tick to avoid synchronous setState warning
    const timeoutId = setTimeout(() => {
      void initFetch();
    }, 0);

    // Subscribe to sync_status changes
    const statusChannel = supabase
      .channel(`sync-status-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sync_status',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          console.log('Status change:', payload);
          if (payload.new && typeof payload.new === 'object' && 'status' in payload.new) {
            const newStatus = payload.new.status as SyncStatus;
            setStatus(newStatus);
            
            // Fetch emails when status changes to complete
            if (newStatus === 'complete') {
              void fetchEmails(userId);
            }
          }
        }
      )
      .subscribe();

    // Subscribe to emails changes
    const emailsChannel = supabase
      .channel(`emails-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'emails',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void fetchEmails(userId);
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      supabase.removeChannel(statusChannel);
      supabase.removeChannel(emailsChannel);
    };
  }, [user?.id, fetchStatus, fetchEmails]);

  // Handle Gmail connection success - Nango webhook will trigger Inngest
  const handleConnectionSuccess = async () => {
    // Set to fetching - Inngest will update status via Supabase
    setStatus('fetching');
    // The real flow happens via: Nango webhook → Inngest → Supabase → Realtime
  };

  // Handle connection error
  const handleConnectionError = (error: Error) => {
    console.error('Gmail connection failed:', error.message);
    setStatus('error');
  };

  // Reconnect Gmail
  const handleReconnect = async () => {
    if (!user?.id) return;
    
    // Clear local state
    setStatus('disconnected');
    setEmails([]);
    
    // Clear Supabase data for this user
    await supabase.from('sync_status').delete().eq('user_id', user.id);
    await supabase.from('emails').delete().eq('user_id', user.id);
  };

  // Loading state
  if (!isLoaded) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-64 mb-8" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      {/* Welcome Section */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Welcome back, {user?.firstName || 'User'}
          </h1>
          <p className="text-muted-foreground">
            Here is your daily strategic overview
          </p>
        </div>
        
        {/* Refresh Button */}
        {status === 'complete' && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleReconnect}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh Data
          </Button>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          DASHBOARD GRID LAYOUT (P0)
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Top Left: Daily Briefing (2 cols) */}
        <div className="lg:col-span-2 min-h-[350px]">
          <DailyBriefingWidget />
        </div>

        {/* Top Right: Goal Progress (1 col) */}
        <div className="lg:col-span-1 min-h-[350px]">
          <GoalProgressWidget />
        </div>

        {/* Middle Left: Schedule (1 col - but actually maybe 1 or 2 depending on design)
            Based on spec diagram: [Schedule] [Key Decisions]
            Let's make them split the row.
        */}
        <div className="lg:col-span-2 min-h-[300px]">
          <ScheduleWidget />
        </div>

        {/* Middle Right: Key Decisions */}
        <div className="lg:col-span-1 min-h-[300px]">
          <KeyDecisionsWidget />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          PHASE 0 INTEGRATION & EMAIL WIDGETS
          Kept for validation and email list view
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-4">Integrations & Data Flow</h3>
        
        {status === 'disconnected' && (
          <Card className="p-8 bg-card border-border mb-6">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Mail className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Connect Your Gmail
              </h2>
              <p className="text-muted-foreground mb-6 max-w-md">
                Connect your Google account to test the architectural pipeline.
                We&apos;ll fetch your last 5 emails through the secure DLP gate.
              </p>
              <ConnectGmail 
                onConnectionSuccess={handleConnectionSuccess}
                onConnectionError={handleConnectionError}
              />
              <p className="text-xs text-muted-foreground mt-6">
                Data flow: Gmail → Nango → Inngest → [2s DLP Gate] → Supabase → UI
              </p>
            </div>
          </Card>
        )}

        {status === 'fetching' && (
          <Card className="p-8 bg-card border-border mb-6">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="h-16 w-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
                <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Fetching Emails...
              </h2>
              <p className="text-muted-foreground mb-6">
                Retrieving your latest messages from Gmail via Nango
              </p>
              <div className="flex items-center gap-4 mt-4">
                <StepIndicator label="Fetch" status="active" />
                <div className="h-px w-8 bg-border" />
                <StepIndicator label="DLP Scan" status="pending" />
                <div className="h-px w-8 bg-border" />
                <StepIndicator label="Secure" status="pending" />
              </div>
            </div>
          </Card>
        )}

        {status === 'securing' && (
          <Card className="p-8 bg-card border-border border-orange-500/30 mb-6">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="h-16 w-16 rounded-full bg-orange-500/10 flex items-center justify-center mb-4 relative">
                <Lock className="h-8 w-8 text-orange-500" />
                <div className="absolute inset-0 rounded-full border-2 border-orange-500/50 animate-ping" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Securing Data...
              </h2>
              <p className="text-muted-foreground mb-2">
                Nightfall DLP Scan in Progress
              </p>
              <p className="text-xs text-orange-500 font-medium mb-6">
                ⏱ Scanning email content for sensitive information...
              </p>
              <div className="flex items-center gap-4 mt-4">
                <StepIndicator label="Fetch" status="complete" />
                <div className="h-px w-8 bg-primary" />
                <StepIndicator label="DLP Scan" status="active" />
                <div className="h-px w-8 bg-border" />
                <StepIndicator label="Secure" status="pending" />
              </div>
            </div>
          </Card>
        )}

        {status === 'complete' && (
          <div className="mb-6">
            <Card className="bg-card border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-secondary/30 flex justify-between items-center">
                <h3 className="text-sm font-medium text-foreground">Recently Secured Emails</h3>
                <div className="flex items-center gap-2 text-green-500 text-xs">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>DLP Verified</span>
                </div>
              </div>
              <div className="divide-y divide-border">
                {emails.map((email) => (
                  <div key={email.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {formatSender(email.sender)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          · {formatDate(email.received_at)}
                        </span>
                        <Shield className="h-3 w-3 text-green-500 flex-shrink-0" />
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{email.subject}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-4">
          <IntegrationCard
            icon={<Mail className="h-5 w-5" />}
            title="Gmail"
            status={
              status === 'complete' ? 'connected' : 
              status === 'error' ? 'error' :
              status === 'disconnected' ? 'pending' : 'syncing'
            }
            description={
              status === 'complete' 
                ? `${emails.length} emails synced`
                : status === 'error'
                ? 'Connection failed'
                : status === 'disconnected'
                ? 'Not connected'
                : 'Syncing...'
            }
          />
          <IntegrationCard
            icon={<Calendar className="h-5 w-5" />}
            title="Calendar"
            status="pending"
            description="Phase 1 scope"
          />
          <IntegrationCard
            icon={<FileText className="h-5 w-5" />}
            title="Drive"
            status="pending"
            description="Phase 1 scope"
          />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function StepIndicator({ 
  label, 
  status 
}: { 
  label: string; 
  status: 'pending' | 'active' | 'complete';
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`
        h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium
        ${status === 'complete' ? 'bg-primary text-primary-foreground' : ''}
        ${status === 'active' ? 'bg-orange-500 text-white' : ''}
        ${status === 'pending' ? 'bg-secondary text-muted-foreground' : ''}
      `}>
        {status === 'complete' ? <CheckCircle2 className="h-4 w-4" /> : null}
        {status === 'active' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {status === 'pending' ? '○' : null}
      </div>
      <span className={`text-xs ${status === 'pending' ? 'text-muted-foreground' : 'text-foreground'}`}>
        {label}
      </span>
    </div>
  );
}

function IntegrationCard({
  icon,
  title,
  status,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  status: 'connected' | 'pending' | 'error' | 'syncing';
  description: string;
}) {
  const statusConfig = {
    connected: {
      color: 'bg-green-500/10 text-green-500 border-green-500/20',
      label: 'Connected',
    },
    pending: {
      color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      label: 'Pending',
    },
    error: {
      color: 'bg-red-500/10 text-red-500 border-red-500/20',
      label: 'Error',
    },
    syncing: {
      color: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      label: 'Syncing',
    },
  };

  const config = statusConfig[status];

  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center text-primary">
            {icon}
          </div>
          <div>
            <h4 className="font-medium text-foreground">{title}</h4>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full border ${config.color}`}>
          {config.label}
        </span>
      </div>
    </Card>
  );
}
