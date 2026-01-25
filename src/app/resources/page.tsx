'use client';

import { useState } from 'react';
import { FolderOpen, FileText, RefreshCw, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUser } from '@clerk/nextjs';
import { toast } from 'sonner';
import { ConnectDrive } from '@/components/ConnectDrive';
import { cn } from '@/lib/utils';

export default function ResourcesPage() {
  const { user } = useUser();
  const [driveStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
  const [drivePending, setDrivePending] = useState(false);

  const syncDrive = async () => {
    toast.info('Drive sync requires backend integration', {
      description: 'Backend APIs are not available in this frontend-only build.',
    });
  };

  const disconnectDrive = async () => {
    toast.info('Disconnect requires backend integration', {
      description: 'Backend APIs are not available in this frontend-only build.',
    });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Resources</h1>
          <p className="text-muted-foreground mt-1">
            Your Google Drive context folder
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Status Badge */}
          <div className="hidden md:flex items-center">
            {drivePending ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-status-amber bg-status-amber/10 px-3 py-1.5 rounded-lg font-medium border border-status-amber/20">
                <Clock className="h-3.5 w-3.5 animate-spin" /> Connecting…
              </span>
            ) : driveStatus === 'connected' ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-status-green bg-status-green/10 px-3 py-1.5 rounded-lg font-medium border border-status-green/20">
                <CheckCircle2 className="h-3.5 w-3.5" /> Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary/50 px-3 py-1.5 rounded-lg font-medium border border-border">
                <XCircle className="h-3.5 w-3.5" /> Not connected
              </span>
            )}
          </div>
          
          <Button variant="outline" className="gap-2 font-medium" onClick={syncDrive}>
            <RefreshCw className="h-4 w-4" />
            Sync Drive
          </Button>
          
          {driveStatus === 'connected' ? (
            <Button variant="outline" onClick={disconnectDrive} className="font-medium">
              Disconnect
            </Button>
          ) : (
            <ConnectDrive
              onConnectionStart={() => setDrivePending(true)}
              onConnectionSuccess={() => setDrivePending(false)}
              onConnectionError={() => setDrivePending(false)}
            />
          )}
        </div>
      </div>

      {/* Content */}
      <Card className="p-6">
        <div className="flex flex-col items-center justify-center text-center py-16">
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 rounded-2xl blur-xl" />
            <div className="relative h-20 w-20 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-emerald-600/10 flex items-center justify-center ring-1 ring-emerald-500/20">
              <FolderOpen className="h-10 w-10 text-emerald-400" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">No documents synced</h2>
          <p className="text-muted-foreground max-w-md mb-8 leading-relaxed">
            {driveStatus !== 'connected'
              ? 'Connect Drive to start your initial sync automatically.'
              : 'No documents available. Sync is required.'}
          </p>
          <Button className="gap-2 font-medium" onClick={syncDrive}>
            <FileText className="h-4 w-4" />
            Sync Drive
          </Button>
        </div>
      </Card>
    </div>
  );
}
