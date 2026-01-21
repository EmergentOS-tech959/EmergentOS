'use client';

import { Inbox, Mail, Calendar, FileText, ArrowRight, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export default function InboxPage() {
  const sources = [
    { icon: Mail, label: 'Emails', description: 'Important messages', color: 'text-rose-400', bg: 'bg-rose-500/15', border: 'border-rose-500/20' },
    { icon: Calendar, label: 'Events', description: 'Upcoming schedule', color: 'text-sky-400', bg: 'bg-sky-500/15', border: 'border-sky-500/20' },
    { icon: FileText, label: 'Documents', description: 'Recent files', color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/20' },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Unified Inbox</h1>
        <p className="text-muted-foreground mt-1">
          All your important items in one place
        </p>
      </div>

      {/* Empty State */}
      <Card className="p-12">
        <div className="flex flex-col items-center justify-center text-center max-w-lg mx-auto">
          {/* Icon */}
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-teal-600/10 rounded-2xl blur-xl" />
            <div className="relative h-20 w-20 rounded-2xl bg-gradient-to-br from-primary/15 to-teal-600/10 flex items-center justify-center ring-1 ring-primary/20">
              <Inbox className="h-10 w-10 text-primary" />
            </div>
          </div>
          
          {/* Title & Description */}
          <h2 className="text-xl font-bold text-foreground mb-2">
            Your Unified Inbox
          </h2>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            Connect your Gmail, Calendar, and Drive to see all your important
            items consolidated here. AI will help prioritize what matters most.
          </p>
          
          {/* Category Indicators */}
          <div className="flex flex-wrap justify-center gap-3 mb-8">
            {sources.map((source) => (
              <div 
                key={source.label}
                className={cn(
                  'flex items-center gap-2.5 px-4 py-2.5 rounded-xl border transition-all hover:scale-105',
                  source.bg, source.border
                )}
              >
                <source.icon className={cn('h-5 w-5', source.color)} />
                <div className="text-left">
                  <span className="text-sm font-medium text-foreground block">{source.label}</span>
                  <span className="text-[10px] text-muted-foreground">{source.description}</span>
                </div>
              </div>
            ))}
          </div>
          
          {/* CTA */}
          <Link href="/settings">
            <Button className="font-medium gap-2">
              <Sparkles className="h-4 w-4" />
              Connect Your Accounts
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </Card>

      {/* Feature Preview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5 bg-card/50">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/15 flex items-center justify-center ring-1 ring-rose-500/20">
              <Mail className="h-5 w-5 text-rose-400" />
            </div>
            <h4 className="font-semibold text-foreground">Smart Email Triage</h4>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            AI-powered prioritization surfaces important emails first, with automated summaries and suggested actions.
          </p>
        </Card>
        
        <Card className="p-5 bg-card/50">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 flex items-center justify-center ring-1 ring-sky-500/20">
              <Calendar className="h-5 w-5 text-sky-400" />
            </div>
            <h4 className="font-semibold text-foreground">Event Insights</h4>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            See upcoming meetings with preparation context, attendee insights, and conflict detection.
          </p>
        </Card>
        
        <Card className="p-5 bg-card/50">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center ring-1 ring-emerald-500/20">
              <FileText className="h-5 w-5 text-emerald-400" />
            </div>
            <h4 className="font-semibold text-foreground">Document Context</h4>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Recently modified documents surface automatically with AI-generated summaries and related emails.
          </p>
        </Card>
        </div>
    </div>
  );
}
