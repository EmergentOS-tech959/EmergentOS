'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GitBranch, MessageSquare } from 'lucide-react';

export function KeyDecisionsWidget() {
  return (
    <Card className="col-span-1 p-6 border-border h-full flex flex-col justify-center items-center text-center">
      <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center mb-4">
        <GitBranch className="h-6 w-6 text-muted-foreground" />
      </div>
      
      <h3 className="font-semibold text-lg mb-2">No Pending Decisions</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-[200px]">
        You&apos;re all caught up on strategic decisions.
      </p>
      
      <Button 
        variant="outline" 
        size="sm"
        className="gap-2 group"
        onClick={() => {
          window.dispatchEvent(new CustomEvent('open-omni-panel'));
        }}
      >
        <MessageSquare className="h-3 w-3 group-hover:text-primary transition-colors" />
        Ask a Strategic Question
      </Button>
    </Card>
  );
}
