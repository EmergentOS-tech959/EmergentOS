'use client';

import { useUser, UserButton } from '@clerk/nextjs';
import { useState, useEffect, useCallback } from 'react';
import { Shield, Mail, Calendar, FileText, CheckCircle2, Lock, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConnectGmail } from '@/components/ConnectGmail';
import { supabase } from '@/lib/supabase-client';

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
  const [errorMessage, setErrorMessage] = useState<string>('');

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
  const fetchStatus = useCallback(async () => {
    if (!user?.id) return;
    
    const { data, error } = await supabase
      .from('sync_status')
      .select('status, updated_at')
      .eq('user_id', user.id)
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
          await supabase.from('sync_status').delete().eq('user_id', user.id);
          return;
        }
      }
      
      setStatus(data.status as SyncStatus);
    } else {
      setStatus('disconnected');
    }
  }, [user?.id]);

  // Fetch emails from Supabase
  const fetchEmails = useCallback(async () => {
    if (!user?.id) return;
    
    const { data, error } = await supabase
      .from('emails')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (error) {
      console.error('Error fetching emails:', error);
      return;
    }
    
    if (data) {
      setEmails(data as Email[]);
    }
  }, [user?.id]);

  // Set up initial fetch and realtime subscription
  useEffect(() => {
    if (!user?.id) return;

    // Initial fetch
    fetchStatus();
    fetchEmails();

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
              fetchEmails();
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
          fetchEmails();
        }
      )
      .subscribe();

    return () => {
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
    setErrorMessage('Failed to connect to Gmail. Please try again.');
  };

  // Reconnect Gmail
  const handleReconnect = async () => {
    if (!user?.id) return;
    
    // Clear local state
    setStatus('disconnected');
    setEmails([]);
    setErrorMessage('');
    
    // Clear Supabase data for this user
    await supabase.from('sync_status').delete().eq('user_id', user.id);
    await supabase.from('emails').delete().eq('user_id', user.id);
  };

  // Loading state
  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader isLoading />
        <main className="container mx-auto px-6 py-8">
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64 mb-8" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader user={user} />
      
      <main className="container mx-auto px-6 py-8">
        {/* Welcome Section */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Welcome back, {user?.firstName || 'User'}
            </h1>
            <p className="text-muted-foreground">
              Phase 0 — Architectural Validation Dashboard
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
              Refresh
            </Button>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            STATE: Disconnected - Show Gmail Connect
        ═══════════════════════════════════════════════════════════════════ */}
        {status === 'disconnected' && (
          <Card className="p-8 bg-card border-border">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Mail className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Connect Your Gmail
              </h2>
              <p className="text-muted-foreground mb-6 max-w-md">
                Connect your Google account to test the architectural pipeline.
                We'll fetch your last 5 emails through the secure DLP gate.
              </p>
              
              {/* REAL Nango OAuth Connection */}
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

        {/* ═══════════════════════════════════════════════════════════════════
            STATE: Error - Connection or sync failed
        ═══════════════════════════════════════════════════════════════════ */}
        {status === 'error' && (
          <Card className="p-8 bg-card border-border border-red-500/30">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="h-16 w-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                <Mail className="h-8 w-8 text-red-500" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Connection Failed
              </h2>
              <p className="text-muted-foreground mb-6">
                {errorMessage}
              </p>
              
              <Button 
                onClick={handleReconnect}
                variant="outline"
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
            </div>
          </Card>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STATE: Fetching - Getting emails from Gmail via Nango
        ═══════════════════════════════════════════════════════════════════ */}
        {status === 'fetching' && (
          <Card className="p-8 bg-card border-border">
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
              
              {/* Progress Steps */}
              <div className="flex items-center gap-4 mt-4">
                <StepIndicator label="Fetch" status="active" />
                <div className="h-px w-8 bg-border" />
                <StepIndicator label="DLP Scan" status="pending" />
                <div className="h-px w-8 bg-border" />
                <StepIndicator label="Secure" status="pending" />
              </div>
              
              <p className="text-xs text-muted-foreground mt-6 font-mono">
                nango.proxy → gmail/v1/users/me/messages
              </p>
            </div>
          </Card>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STATE: Securing - DLP Security Scan (2 second blocking delay)
        ═══════════════════════════════════════════════════════════════════ */}
        {status === 'securing' && (
          <Card className="p-8 bg-card border-border border-orange-500/30">
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
              
              {/* Progress Steps */}
              <div className="flex items-center gap-4 mt-4">
                <StepIndicator label="Fetch" status="complete" />
                <div className="h-px w-8 bg-primary" />
                <StepIndicator label="DLP Scan" status="active" />
                <div className="h-px w-8 bg-border" />
                <StepIndicator label="Secure" status="pending" />
              </div>
              
              <p className="text-xs text-muted-foreground mt-6 font-mono">
                Inngest → step.run('nightfall-dlp-scan')
              </p>
            </div>
          </Card>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STATE: Complete - Show Email List (Compact)
        ═══════════════════════════════════════════════════════════════════ */}
        {status === 'complete' && (
          <div className="max-w-xl mx-auto space-y-4">
            {/* Success Header */}
            <Card className="p-4 bg-green-500/5 border-green-500/20">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <div>
                  <p className="font-medium text-foreground">Security Check Complete</p>
                  <p className="text-sm text-muted-foreground">
                    {emails.length} emails passed DLP verification
                  </p>
                </div>
              </div>
            </Card>
            
            {/* Compact Email List */}
            <Card className="bg-card border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-secondary/30">
                <h3 className="text-sm font-medium text-foreground">Recent Emails</h3>
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

        {/* Integration Status Cards */}
        <div className="grid md:grid-cols-3 gap-4 mt-8">
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
      </main>
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

function DashboardHeader({ 
  user, 
  isLoading 
}: { 
  user?: ReturnType<typeof useUser>['user']; 
  isLoading?: boolean;
}) {
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <Shield className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold text-foreground">EmergentOS</span>
          <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full ml-2">
            Phase 0
          </span>
        </div>
        
        <div className="flex items-center gap-4">
          {isLoading ? (
            <Skeleton className="h-9 w-9 rounded-full" />
          ) : (
            <>
              <span className="text-sm text-muted-foreground hidden md:block">
                {user?.primaryEmailAddress?.emailAddress}
              </span>
              <UserButton 
                afterSignOutUrl="/"
                appearance={{
                  elements: {
                    avatarBox: 'h-9 w-9 ring-2 ring-primary/20',
                  },
                }}
              />
            </>
          )}
        </div>
      </div>
    </header>
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
