'use client';

import { Mail, Shield, CheckCircle, Clock, User } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Email } from '@/types';

interface EmailListProps {
  emails: Email[];
  onRefresh?: () => void;
}

/**
 * EmailList Component
 * Displays the list of emails that have passed through the DLP security gate
 * 
 * Each email shows:
 * - Sender
 * - Subject
 * - Received date
 * - Security verified badge
 */
export function EmailList({ emails }: EmailListProps) {
  if (emails.length === 0) {
    return (
      <Card className="p-8 bg-card border-border">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="h-16 w-16 rounded-full bg-secondary flex items-center justify-center mb-4">
            <Mail className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">
            No Emails Found
          </h2>
          <p className="text-muted-foreground">
            No emails were retrieved. Try refreshing or reconnecting Gmail.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">Recent Emails</h2>
          <Badge variant="secondary" className="text-xs">
            {emails.length} messages
          </Badge>
        </div>
        <Badge 
          variant="outline" 
          className="text-primary border-primary/50 bg-primary/5"
        >
          <CheckCircle className="h-3 w-3 mr-1" />
          Security Verified
        </Badge>
      </div>

      {/* Success message */}
      <Card className="p-4 bg-green-500/5 border-green-500/20">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
            <Shield className="h-5 w-5 text-green-500" />
          </div>
          <div>
            <p className="font-medium text-green-500">DLP Security Gate Passed</p>
            <p className="text-sm text-muted-foreground">
              All emails have been verified and are safe to display
            </p>
          </div>
        </div>
      </Card>

      {/* Email list */}
      <div className="space-y-2">
        {emails.map((email, index) => (
          <EmailCard key={email.id} email={email} index={index} />
        ))}
      </div>

      {/* Footer info */}
      <p className="text-xs text-muted-foreground text-center pt-4">
        Emails fetched via Nango → Processed by Inngest → Verified by mock DLP → Stored in Supabase
      </p>
    </div>
  );
}

function EmailCard({ email, index }: { email: Email; index: number }) {
  // Parse the sender name from email format "Name <email@example.com>"
  const parseSender = (sender: string) => {
    const match = sender.match(/^(.+?)\s*<(.+)>$/);
    if (match) {
      return { name: match[1].trim(), email: match[2] };
    }
    return { name: sender, email: sender };
  };

  const { name, email: senderEmail } = parseSender(email.sender);

  // Format the date
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  return (
    <Card 
      className="p-4 bg-card border-border hover:border-primary/50 transition-all duration-200 hover:shadow-lg hover:shadow-primary/5 group"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center flex-shrink-0 group-hover:from-primary/30 group-hover:to-primary/10 transition-colors">
          <User className="h-5 w-5 text-primary" />
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">
                {name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {senderEmail !== name ? senderEmail : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(email.received_at)}
              </span>
            </div>
          </div>
          
          <p className="text-sm text-muted-foreground mt-1 truncate">
            {email.subject}
          </p>
        </div>

        {/* Security badge */}
        {email.security_verified && (
          <div className="flex-shrink-0" title="Security Verified">
            <Shield className="h-4 w-4 text-primary opacity-50 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
      </div>
    </Card>
  );
}

