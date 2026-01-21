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
    <CommandDialog open={isOpen} onOpenChange={onClose}>
      <div className="bg-background border-border rounded-2xl overflow-hidden">
        <CommandInput
          placeholder="Type a command or search..."
          value={search}
          onValueChange={setSearch}
          className="h-14 text-base border-b border-border bg-transparent text-foreground placeholder:text-muted-foreground px-5"
        />
        <CommandList className="max-h-[450px] p-4 overflow-y-auto eos-scrollbar">
          <CommandEmpty>
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="w-14 h-14 rounded-2xl bg-secondary/50 flex items-center justify-center">
                <Search className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <div className="text-center">
                <p className="text-sm text-foreground font-medium">No results found</p>
                <p className="text-xs text-muted-foreground mt-1">Try a different search term</p>
              </div>
            </div>
          </CommandEmpty>

          {/* Navigation */}
          <CommandGroup heading="Navigation" className="mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold px-1 mb-3">Navigate</p>
            <div className="grid grid-cols-2 gap-2">
              <CommandItem 
                onSelect={() => handleSelect(() => router.push('/dashboard'))} 
                className={cn(
                  'flex items-center gap-3 py-3.5 px-3.5 rounded-xl bg-card border border-border cursor-pointer',
                  'hover:border-primary/30 hover:bg-secondary/50 transition-all duration-200 data-[selected=true]:border-primary/30 data-[selected=true]:bg-secondary/50'
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500/20 to-teal-600/10 flex items-center justify-center ring-1 ring-teal-500/20">
                  <LayoutDashboard className="h-5 w-5 text-teal-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground block">Dashboard</span>
                  <p className="text-[10px] text-muted-foreground">Overview & briefing</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
              </CommandItem>
              
              <CommandItem 
                onSelect={() => handleSelect(() => router.push('/inbox'))} 
                className={cn(
                  'flex items-center gap-3 py-3.5 px-3.5 rounded-xl bg-card border border-border cursor-pointer',
                  'hover:border-primary/30 hover:bg-secondary/50 transition-all duration-200 data-[selected=true]:border-primary/30 data-[selected=true]:bg-secondary/50'
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 flex items-center justify-center ring-1 ring-purple-500/20">
                  <Inbox className="h-5 w-5 text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground block">Inbox</span>
                  <p className="text-[10px] text-muted-foreground">Unified messages</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
              </CommandItem>
              
              <CommandItem 
                onSelect={() => handleSelect(() => router.push('/resources'))} 
                className={cn(
                  'flex items-center gap-3 py-3.5 px-3.5 rounded-xl bg-card border border-border cursor-pointer',
                  'hover:border-primary/30 hover:bg-secondary/50 transition-all duration-200 data-[selected=true]:border-primary/30 data-[selected=true]:bg-secondary/50'
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center ring-1 ring-emerald-500/20">
                  <FolderOpen className="h-5 w-5 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground block">Resources</span>
                  <p className="text-[10px] text-muted-foreground">Files & documents</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
              </CommandItem>
              
              <CommandItem 
                onSelect={() => handleSelect(() => router.push('/settings'))} 
                className={cn(
                  'flex items-center gap-3 py-3.5 px-3.5 rounded-xl bg-card border border-border cursor-pointer',
                  'hover:border-primary/30 hover:bg-secondary/50 transition-all duration-200 data-[selected=true]:border-primary/30 data-[selected=true]:bg-secondary/50'
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-500/20 to-gray-600/10 flex items-center justify-center ring-1 ring-gray-500/20">
                  <Settings className="h-5 w-5 text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground block">Settings</span>
                  <p className="text-[10px] text-muted-foreground">Connections & prefs</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
              </CommandItem>
            </div>
          </CommandGroup>

          <CommandSeparator className="my-4 bg-border" />

          {/* Quick Actions */}
          <CommandGroup heading="Quick Actions" className="mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold px-1 mb-3">Actions</p>
            <div className="grid grid-cols-2 gap-2">
              <CommandItem 
                onSelect={() => handleSelect(() => void fetch('/api/ai/briefing/generate', { method: 'POST' }))} 
                className={cn(
                  'flex items-center gap-3 py-3.5 px-3.5 rounded-xl bg-card border border-border cursor-pointer',
                  'hover:border-amber-500/30 hover:bg-gradient-copper transition-all duration-200 data-[selected=true]:border-amber-500/30 data-[selected=true]:bg-gradient-copper'
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center ring-1 ring-amber-500/20">
                  <RefreshCw className="h-5 w-5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground block">Refresh Briefing</span>
                  <p className="text-[10px] text-muted-foreground">Regenerate daily brief</p>
                </div>
              </CommandItem>
              
              <CommandItem 
                onSelect={() => handleSelect(() => window.dispatchEvent(new CustomEvent('open-omni-panel')))} 
                className={cn(
                  'flex items-center gap-3 py-3.5 px-3.5 rounded-xl bg-card border border-border cursor-pointer',
                  'hover:border-amber-500/30 hover:bg-gradient-copper transition-all duration-200 data-[selected=true]:border-amber-500/30 data-[selected=true]:bg-gradient-copper'
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center ring-1 ring-amber-500/20">
                  <Sparkles className="h-5 w-5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground block">Ask AI</span>
                  <p className="text-[10px] text-muted-foreground">Chat with assistant</p>
                </div>
              </CommandItem>
            </div>
          </CommandGroup>

          <CommandSeparator className="my-4 bg-border" />

          {/* Search Filters */}
          <CommandGroup heading="Search In" className="mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold px-1 mb-3">Filter by source</p>
            <div className="grid grid-cols-3 gap-2">
              <CommandItem 
                onSelect={() => setSearch('email:')} 
                className={cn(
                  'flex flex-col items-center gap-2 py-4 px-3 rounded-xl bg-card border border-border cursor-pointer',
                  'hover:border-rose-500/30 hover:bg-rose-500/5 transition-all duration-200 data-[selected=true]:border-rose-500/30 data-[selected=true]:bg-rose-500/5'
                )}
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500/20 to-rose-600/10 flex items-center justify-center ring-1 ring-rose-500/20">
                  <Mail className="h-6 w-6 text-rose-400" />
                </div>
                <span className="text-xs text-foreground font-medium">Emails</span>
              </CommandItem>
              
              <CommandItem 
                onSelect={() => setSearch('cal:')} 
                className={cn(
                  'flex flex-col items-center gap-2 py-4 px-3 rounded-xl bg-card border border-border cursor-pointer',
                  'hover:border-sky-500/30 hover:bg-sky-500/5 transition-all duration-200 data-[selected=true]:border-sky-500/30 data-[selected=true]:bg-sky-500/5'
                )}
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500/20 to-sky-600/10 flex items-center justify-center ring-1 ring-sky-500/20">
                  <Calendar className="h-6 w-6 text-sky-400" />
                </div>
                <span className="text-xs text-foreground font-medium">Calendar</span>
              </CommandItem>
              
              <CommandItem 
                onSelect={() => setSearch('doc:')} 
                className={cn(
                  'flex flex-col items-center gap-2 py-4 px-3 rounded-xl bg-card border border-border cursor-pointer',
                  'hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all duration-200 data-[selected=true]:border-emerald-500/30 data-[selected=true]:bg-emerald-500/5'
                )}
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center ring-1 ring-emerald-500/20">
                  <FileText className="h-6 w-6 text-emerald-400" />
                </div>
                <span className="text-xs text-foreground font-medium">Documents</span>
              </CommandItem>
            </div>
          </CommandGroup>

          {/* Keyboard shortcuts hint */}
          <div className="mt-5 pt-4 border-t border-border flex items-center justify-center gap-6 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <kbd className="px-2 py-1 rounded-md bg-secondary border border-border text-muted-foreground font-mono">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-2 py-1 rounded-md bg-secondary border border-border text-muted-foreground font-mono">↵</kbd>
              Select
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-2 py-1 rounded-md bg-secondary border border-border text-muted-foreground font-mono">Esc</kbd>
              Close
            </span>
          </div>
        </CommandList>
      </div>
    </CommandDialog>
  );
}
