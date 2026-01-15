'use client';

import { useUser } from '@clerk/nextjs';
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
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface ConnectionCardProps {
  name: string;
  description: string;
  icon: React.ReactNode;
  status: 'connected' | 'disconnected' | 'error';
  lastSync?: string;
  itemCount?: number;
  onConnect: () => void;
  onDisconnect: () => void;
}

function ConnectionCard({
  name,
  description,
  icon,
  status,
  lastSync,
  itemCount,
  onConnect,
  onDisconnect,
}: ConnectionCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center">
            {icon}
          </div>
          <div>
            <h4 className="font-medium">{name}</h4>
            <p className="text-sm text-muted-foreground">{description}</p>
            {status === 'connected' && lastSync && (
              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>Last sync: {lastSync}</span>
                {itemCount !== undefined && (
                  <>
                    <span>•</span>
                    <span>{itemCount} items</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status === 'connected' && (
            <div className="flex items-center gap-1 text-xs text-status-green">
              <CheckCircle2 className="h-3 w-3" />
              <span>Connected</span>
            </div>
          )}
          {status === 'disconnected' && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <XCircle className="h-3 w-3" />
              <span>Not connected</span>
            </div>
          )}
          {status === 'error' && (
            <div className="flex items-center gap-1 text-xs text-status-red">
              <XCircle className="h-3 w-3" />
              <span>Error</span>
            </div>
          )}
          <Button
            variant={status === 'connected' ? 'outline' : 'default'}
            size="sm"
            onClick={status === 'connected' ? onDisconnect : onConnect}
          >
            {status === 'connected' ? 'Disconnect' : 'Connect'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useUser();

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account and preferences
        </p>
      </div>

      <Tabs defaultValue="account" className="space-y-6">
        <TabsList>
          <TabsTrigger value="account" className="gap-2">
            <User className="h-4 w-4" />
            Account
          </TabsTrigger>
          <TabsTrigger value="connections" className="gap-2">
            <Link2 className="h-4 w-4" />
            Connections
          </TabsTrigger>
          <TabsTrigger value="preferences" className="gap-2">
            <Bell className="h-4 w-4" />
            Preferences
          </TabsTrigger>
          <TabsTrigger value="data" className="gap-2">
            <Database className="h-4 w-4" />
            Data
          </TabsTrigger>
        </TabsList>

        {/* Account Tab */}
        <TabsContent value="account" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-medium mb-4">Profile</h3>
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={user?.imageUrl} />
                <AvatarFallback>
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </AvatarFallback>
              </Avatar>
              <div>
                <h4 className="font-medium">
                  {user?.fullName || 'User'}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {user?.primaryEmailAddress?.emailAddress}
                </p>
              </div>
            </div>
            <Separator className="my-6" />
            <p className="text-sm text-muted-foreground">
              Account managed by Clerk. Click your avatar in the header to update profile settings.
            </p>
          </Card>
        </TabsContent>

        {/* Connections Tab */}
        <TabsContent value="connections" className="space-y-4">
          <ConnectionCard
            name="Gmail"
            description="Access your email for AI insights"
            icon={<Mail className="h-5 w-5 text-primary" />}
            status="disconnected"
            onConnect={() => console.log('Connect Gmail')}
            onDisconnect={() => console.log('Disconnect Gmail')}
          />
          <ConnectionCard
            name="Google Calendar"
            description="Sync your calendar events"
            icon={<Calendar className="h-5 w-5 text-primary" />}
            status="disconnected"
            onConnect={() => console.log('Connect Calendar')}
            onDisconnect={() => console.log('Disconnect Calendar')}
          />
          <ConnectionCard
            name="Google Drive"
            description="Access your documents for context"
            icon={<FileText className="h-5 w-5 text-primary" />}
            status="disconnected"
            onConnect={() => console.log('Connect Drive')}
            onDisconnect={() => console.log('Disconnect Drive')}
          />
        </TabsContent>

        {/* Preferences Tab */}
        <TabsContent value="preferences" className="space-y-4">
          <Card className="p-6 space-y-6">
            <h3 className="text-lg font-medium">Notifications</h3>
            
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="daily-briefing">Daily Briefing</Label>
                <p className="text-sm text-muted-foreground">
                  Receive your AI briefing every morning
                </p>
              </div>
              <Switch id="daily-briefing" defaultChecked />
            </div>
            
            <Separator />
            
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="conflict-alerts">Calendar Conflict Alerts</Label>
                <p className="text-sm text-muted-foreground">
                  Get notified about scheduling conflicts
                </p>
              </div>
              <Switch id="conflict-alerts" defaultChecked />
            </div>
            
            <Separator />
            
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="email-summary">Email Summary</Label>
                <p className="text-sm text-muted-foreground">
                  Weekly digest of important emails
                </p>
              </div>
              <Switch id="email-summary" />
            </div>
          </Card>
        </TabsContent>

        {/* Data Tab */}
        <TabsContent value="data" className="space-y-4">
          <Card className="p-6 space-y-4">
            <h3 className="text-lg font-medium">Export Data</h3>
            <p className="text-sm text-muted-foreground">
              Download all your data including emails, calendar events, and AI-generated content.
            </p>
            <Button variant="outline">Export My Data</Button>
          </Card>
          
          <Card className="p-6 space-y-4 border-status-red/50">
            <h3 className="text-lg font-medium text-status-red">Danger Zone</h3>
            <p className="text-sm text-muted-foreground">
              Permanently delete all your data. This action cannot be undone.
            </p>
            <Button variant="destructive">Purge All Data</Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
