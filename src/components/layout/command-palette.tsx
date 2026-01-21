'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  LayoutDashboard,
  Inbox,
  FolderOpen,
  Settings,
  Search,
  Calendar,
  Mail,
  FileText,
  RefreshCw,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const handleSelect = useCallback((callback: () => void) => {
    onClose();
    callback();
  }, [onClose]);

  return (
    <CommandDialog open={isOpen} onOpenChange={onClose} className="max-w-[600px] w-[90vw]">
      <div className="bg-background border-border rounded-xl overflow-hidden">
        <CommandInput
          placeholder="Type a command or search..."
          value={search}
          onValueChange={setSearch}
          className="h-12 text-sm border-b border-border bg-transparent text-foreground placeholder:text-muted-foreground px-4"
        />
        <CommandList className="max-h-[400px] p-3 overflow-y-auto eos-scrollbar">
          <CommandEmpty>
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="w-12 h-12 rounded-xl bg-secondary/50 flex items-center justify-center">
                <Search className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <div className="text-center">
                <p className="text-sm text-foreground font-medium">No results found</p>
                <p className="text-xs text-muted-foreground mt-1">Try a different search term</p>
              </div>
            </div>
          </CommandEmpty>

          {/* Navigation */}
          <CommandGroup heading="Navigation" className="mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold px-1 mb-2">Navigate</p>
            <div className="space-y-1">
              <CommandItem 
                onSelect={() => handleSelect(() => router.push('/dashboard'))} 
                className={cn(
                  'flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer',
                  'hover:bg-secondary/60 transition-all duration-150 data-[selected=true]:bg-secondary/60'
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500/20 to-teal-600/10 flex items-center justify-center">
                  <LayoutDashboard className="h-4 w-4 text-teal-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">Dashboard</span>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
              </CommandItem>
              
              <CommandItem 
                onSelect={() => handleSelect(() => router.push('/inbox'))} 
                className={cn(
                  'flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer',
                  'hover:bg-secondary/60 transition-all duration-150 data-[selected=true]:bg-secondary/60'
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-purple-600/10 flex items-center justify-center">
                  <Inbox className="h-4 w-4 text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">Inbox</span>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
              </CommandItem>
              
              <CommandItem 
                onSelect={() => handleSelect(() => router.push('/resources'))} 
                className={cn(
                  'flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer',
                  'hover:bg-secondary/60 transition-all duration-150 data-[selected=true]:bg-secondary/60'
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center">
                  <FolderOpen className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">Resources</span>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
              </CommandItem>
              
              <CommandItem 
                onSelect={() => handleSelect(() => router.push('/settings'))} 
                className={cn(
                  'flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer',
                  'hover:bg-secondary/60 transition-all duration-150 data-[selected=true]:bg-secondary/60'
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-500/20 to-gray-600/10 flex items-center justify-center">
                  <Settings className="h-4 w-4 text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">Settings</span>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
              </CommandItem>
            </div>
          </CommandGroup>

          <CommandSeparator className="my-3 bg-border" />

          {/* Quick Actions */}
          <CommandGroup heading="Quick Actions" className="mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold px-1 mb-2">Actions</p>
            <div className="space-y-1">
              <CommandItem 
                onSelect={() => handleSelect(() => void fetch('/api/ai/briefing/generate', { method: 'POST' }))} 
                className={cn(
                  'flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer',
                  'hover:bg-amber-500/10 transition-all duration-150 data-[selected=true]:bg-amber-500/10'
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center">
                  <RefreshCw className="h-4 w-4 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">Refresh Briefing</span>
                </div>
              </CommandItem>
              
              <CommandItem 
                onSelect={() => handleSelect(() => window.dispatchEvent(new CustomEvent('open-omni-panel')))} 
                className={cn(
                  'flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer',
                  'hover:bg-amber-500/10 transition-all duration-150 data-[selected=true]:bg-amber-500/10'
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">Ask AI</span>
                </div>
              </CommandItem>
            </div>
          </CommandGroup>

          <CommandSeparator className="my-3 bg-border" />

          {/* Search Filters */}
          <CommandGroup heading="Search In" className="mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold px-1 mb-2">Filter by source</p>
            <div className="flex gap-2">
              <CommandItem 
                onSelect={() => setSearch('email:')} 
                className={cn(
                  'flex-1 flex flex-col items-center gap-1.5 py-3 px-2 rounded-lg bg-secondary/30 border border-border/50 cursor-pointer',
                  'hover:border-rose-500/30 hover:bg-rose-500/5 transition-all duration-150 data-[selected=true]:border-rose-500/30 data-[selected=true]:bg-rose-500/5'
                )}
              >
                <Mail className="h-5 w-5 text-rose-400" />
                <span className="text-[11px] text-foreground font-medium">Emails</span>
              </CommandItem>
              
              <CommandItem 
                onSelect={() => setSearch('cal:')} 
                className={cn(
                  'flex-1 flex flex-col items-center gap-1.5 py-3 px-2 rounded-lg bg-secondary/30 border border-border/50 cursor-pointer',
                  'hover:border-sky-500/30 hover:bg-sky-500/5 transition-all duration-150 data-[selected=true]:border-sky-500/30 data-[selected=true]:bg-sky-500/5'
                )}
              >
                <Calendar className="h-5 w-5 text-sky-400" />
                <span className="text-[11px] text-foreground font-medium">Calendar</span>
              </CommandItem>
              
              <CommandItem 
                onSelect={() => setSearch('doc:')} 
                className={cn(
                  'flex-1 flex flex-col items-center gap-1.5 py-3 px-2 rounded-lg bg-secondary/30 border border-border/50 cursor-pointer',
                  'hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all duration-150 data-[selected=true]:border-emerald-500/30 data-[selected=true]:bg-emerald-500/5'
                )}
              >
                <FileText className="h-5 w-5 text-emerald-400" />
                <span className="text-[11px] text-foreground font-medium">Documents</span>
              </CommandItem>
            </div>
          </CommandGroup>

          {/* Keyboard shortcuts hint */}
          <div className="mt-3 pt-3 border-t border-border flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground font-mono text-[9px]">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground font-mono text-[9px]">↵</kbd>
              Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground font-mono text-[9px]">Esc</kbd>
              Close
            </span>
          </div>
        </CommandList>
      </div>
    </CommandDialog>
  );
}
