'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GitBranch, MessageSquare, Sparkles } from 'lucide-react';

export function KeyDecisionsWidget() {
  return (
    <Card className="p-5 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="widget-header">
          <div className="widget-icon bg-gradient-to-br from-rose-500/20 to-pink-500/10 ring-1 ring-rose-500/20">
            <GitBranch className="h-5 w-5 text-rose-400" />
          </div>
          <div>
            <h3 className="widget-title">Decisions</h3>
            <p className="widget-subtitle">Strategic tracker</p>
          </div>
        </div>
      </div>
      
      {/* Empty State */}
      <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
        <div className="relative mb-5">
          <div className="absolute inset-0 bg-secondary/50 rounded-2xl blur-xl" />
          <div className="relative h-14 w-14 rounded-2xl bg-secondary/50 flex items-center justify-center ring-1 ring-border">
            <GitBranch className="h-7 w-7 text-muted-foreground/50" />
          </div>
        </div>
        
        <h4 className="font-semibold text-foreground mb-1">No Pending Decisions</h4>
        <p className="text-xs text-muted-foreground mb-6 max-w-[180px] leading-relaxed">
        You&apos;re all caught up on strategic decisions.
      </p>
      
      <Button 
        variant="outline" 
        size="sm"
          className="gap-2 group font-medium"
        onClick={() => {
          window.dispatchEvent(new CustomEvent('open-omni-panel'));
        }}
      >
          <Sparkles className="h-3.5 w-3.5 text-ai-copper group-hover:text-ai-copper transition-colors" />
          Ask Strategic Question
      </Button>
      </div>

      {/* Footer */}
      <div className="pt-4 mt-auto border-t border-border flex items-center gap-2">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">Decision log coming in Phase 2</span>
      </div>
    </Card>
  );
}
