'use client';

import { Inbox, Mail, Calendar, FileText } from 'lucide-react';
import { Card } from '@/components/ui/card';

export default function InboxPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Unified Inbox</h1>
        <p className="text-muted-foreground">
          All your important items in one place
        </p>
      </div>

      {/* Empty State */}
      <Card className="p-12">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Inbox className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold mb-2">
            Your Unified Inbox
          </h2>
          <p className="text-muted-foreground max-w-md mb-6">
            Connect your Gmail, Calendar, and Drive to see all your important
            items consolidated here.
          </p>
          
          {/* Category Indicators */}
          <div className="flex gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              <span>Emails</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>Events</span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span>Documents</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
