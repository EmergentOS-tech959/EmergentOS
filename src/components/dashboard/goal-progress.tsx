'use client';

import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Target, TrendingUp, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function GoalProgressWidget() {
  const goals = [
    {
      id: 1,
      title: 'Project Hawthorn BETA',
      progress: 33,
      status: 'warning', // amber
      deadline: 'Jan 30',
    },
    {
      id: 2,
      title: 'Y1 Tech Stack',
      progress: 0,
      status: 'on-track', // green
      deadline: 'Feb 15',
    },
  ];

  return (
    <Card className="col-span-1 p-6 border-border h-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold text-lg">Active Goals</h3>
        </div>
      </div>

      <div className="space-y-6">
        {goals.map((goal) => (
          <div key={goal.id} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{goal.title}</span>
              <span className={cn(
                "text-xs px-2 py-0.5 rounded-full",
                goal.status === 'warning' ? "bg-status-amber/10 text-status-amber" : "bg-status-green/10 text-status-green"
              )}>
                {goal.deadline}
              </span>
            </div>
            
            <div className="relative">
              <Progress value={goal.progress} className="h-2" />
              {goal.status === 'warning' && (
                <AlertCircle className="absolute -right-1 -top-6 h-3 w-3 text-status-amber" />
              )}
            </div>
            
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{goal.progress}% Complete</span>
              <span>{goal.status === 'warning' ? 'Needs Attention' : 'On Track'}</span>
            </div>
          </div>
        ))}
        
        {/* Empty state placeholder */}
        <div className="pt-4 border-t border-border border-dashed">
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-2 cursor-pointer hover:text-primary transition-colors">
            <TrendingUp className="h-3 w-3" />
            <span>Add New Goal</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
