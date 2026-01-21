'use client';

import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Target, TrendingUp, AlertCircle, Plus } from 'lucide-react';
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
    <Card className="p-5 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="widget-header">
          <div className="widget-icon bg-gradient-to-br from-violet-500/20 to-purple-500/10 ring-1 ring-violet-500/20">
            <Target className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h3 className="widget-title">Active Goals</h3>
            <p className="widget-subtitle">{goals.length} goals tracked</p>
          </div>
        </div>
      </div>

      {/* Goals List */}
      <div className="flex-1 space-y-4 overflow-y-auto eos-scrollbar-thin">
        {goals.map((goal) => (
          <div key={goal.id} className="space-y-3 p-3.5 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors border border-transparent hover:border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground truncate pr-2">{goal.title}</span>
              <span className={cn(
                "text-[10px] px-2 py-1 rounded-md font-semibold uppercase tracking-wide shrink-0",
                goal.status === 'warning' 
                  ? "bg-status-amber/10 text-status-amber border border-status-amber/20" 
                  : "bg-status-green/10 text-status-green border border-status-green/20"
              )}>
                {goal.deadline}
              </span>
            </div>
            
            <div className="relative">
              <Progress 
                value={goal.progress} 
                className={cn(
                  "h-2.5 bg-secondary",
                  goal.status === 'warning' && "[&>div]:bg-status-amber",
                  goal.status === 'on-track' && "[&>div]:bg-status-green"
                )} 
              />
              {goal.status === 'warning' && goal.progress > 0 && (
                <AlertCircle className="absolute -right-0.5 -top-0.5 h-3 w-3 text-status-amber" />
              )}
            </div>
            
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span className="font-medium">{goal.progress}% Complete</span>
              <span className={cn(
                goal.status === 'warning' ? 'text-status-amber' : 'text-status-green'
              )}>
                {goal.status === 'warning' ? 'Needs Attention' : 'On Track'}
              </span>
            </div>
          </div>
        ))}
        
        {/* Add Goal Button */}
        <button className="w-full p-3 rounded-xl border-2 border-dashed border-border hover:border-primary/30 hover:bg-secondary/30 transition-all group">
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground group-hover:text-foreground transition-colors">
            <Plus className="h-4 w-4" />
            <span className="font-medium">Add New Goal</span>
          </div>
        </button>
        </div>

      {/* Footer */}
      <div className="pt-4 mt-auto border-t border-border flex items-center gap-2">
        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">Goals feature coming in Phase 2</span>
      </div>
    </Card>
  );
}
