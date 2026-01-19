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
      <div className="bg-[#0d1117] border-[#30363d]">
        <CommandInput
          placeholder="Type a command or search..."
          value={search}
          onValueChange={setSearch}
          className="h-14 text-base border-b border-[#30363d] bg-transparent text-white placeholder:text-gray-500"
        />
        <CommandList className="max-h-[400px] p-3 overflow-y-auto">
          <CommandEmpty>
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="w-12 h-12 rounded-xl bg-[#21262d] flex items-center justify-center">
                <Search className="h-5 w-5 text-gray-500" />
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-400">No results found</p>
                <p className="text-xs text-gray-500 mt-1">Try a different search term</p>
              </div>
            </div>
          </CommandEmpty>

          {/* Navigation */}
          <CommandGroup heading="Navigation">
            <div className="grid grid-cols-2 gap-2">
              <CommandItem 
                onSelect={() => handleSelect(() => router.push('/dashboard'))} 
                className="flex items-center gap-3 py-3 px-3 rounded-lg bg-[#161b22] border border-[#30363d] hover:border-teal-500/50 cursor-pointer"
              >
                <div className="w-9 h-9 rounded-lg bg-teal-500/10 flex items-center justify-center">
                  <LayoutDashboard className="h-4 w-4 text-teal-400" />
                </div>
                <div className="flex-1">
                  <span className="text-sm text-white">Dashboard</span>
                  <p className="text-[10px] text-gray-500">Overview & briefing</p>
                </div>
                <ArrowRight className="h-3 w-3 text-gray-600" />
              </CommandItem>
              
              <CommandItem 
                onSelect={() => handleSelect(() => router.push('/inbox'))} 
                className="flex items-center gap-3 py-3 px-3 rounded-lg bg-[#161b22] border border-[#30363d] hover:border-blue-500/50 cursor-pointer"
              >
                <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Inbox className="h-4 w-4 text-blue-400" />
                </div>
                <div className="flex-1">
                  <span className="text-sm text-white">Inbox</span>
                  <p className="text-[10px] text-gray-500">Unified messages</p>
                </div>
                <ArrowRight className="h-3 w-3 text-gray-600" />
              </CommandItem>
              
              <CommandItem 
                onSelect={() => handleSelect(() => router.push('/resources'))} 
                className="flex items-center gap-3 py-3 px-3 rounded-lg bg-[#161b22] border border-[#30363d] hover:border-green-500/50 cursor-pointer"
              >
                <div className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <FolderOpen className="h-4 w-4 text-green-400" />
                </div>
                <div className="flex-1">
                  <span className="text-sm text-white">Resources</span>
                  <p className="text-[10px] text-gray-500">Files & documents</p>
                </div>
                <ArrowRight className="h-3 w-3 text-gray-600" />
              </CommandItem>
              
              <CommandItem 
                onSelect={() => handleSelect(() => router.push('/settings'))} 
                className="flex items-center gap-3 py-3 px-3 rounded-lg bg-[#161b22] border border-[#30363d] hover:border-gray-500/50 cursor-pointer"
              >
                <div className="w-9 h-9 rounded-lg bg-gray-500/10 flex items-center justify-center">
                  <Settings className="h-4 w-4 text-gray-400" />
                </div>
                <div className="flex-1">
                  <span className="text-sm text-white">Settings</span>
                  <p className="text-[10px] text-gray-500">Connections & prefs</p>
                </div>
                <ArrowRight className="h-3 w-3 text-gray-600" />
              </CommandItem>
            </div>
          </CommandGroup>

          <CommandSeparator className="my-3 bg-[#30363d]" />

          {/* Quick Actions */}
          <CommandGroup heading="Quick Actions">
            <div className="grid grid-cols-2 gap-2">
              <CommandItem 
                onSelect={() => handleSelect(() => void fetch('/api/ai/briefing/generate', { method: 'POST' }))} 
                className="flex items-center gap-3 py-3 px-3 rounded-lg bg-[#161b22] border border-[#30363d] hover:border-amber-500/50 cursor-pointer"
              >
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <RefreshCw className="h-4 w-4 text-amber-400" />
                </div>
                <div className="flex-1">
                  <span className="text-sm text-white">Refresh Briefing</span>
                  <p className="text-[10px] text-gray-500">Regenerate daily brief</p>
                </div>
              </CommandItem>
              
              <CommandItem 
                onSelect={() => handleSelect(() => window.dispatchEvent(new CustomEvent('open-omni-panel')))} 
                className="flex items-center gap-3 py-3 px-3 rounded-lg bg-[#161b22] border border-[#30363d] hover:border-amber-500/50 cursor-pointer"
              >
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-amber-400" />
                </div>
                <div className="flex-1">
                  <span className="text-sm text-white">Ask AI</span>
                  <p className="text-[10px] text-gray-500">Chat with assistant</p>
                </div>
              </CommandItem>
            </div>
          </CommandGroup>

          <CommandSeparator className="my-3 bg-[#30363d]" />

          {/* Search Filters */}
          <CommandGroup heading="Search In">
            <div className="grid grid-cols-3 gap-2">
              <CommandItem 
                onSelect={() => setSearch('email:')} 
                className="flex flex-col items-center gap-2 py-3 px-2 rounded-lg bg-[#161b22] border border-[#30363d] hover:border-red-500/50 cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                  <Mail className="h-5 w-5 text-red-400" />
                </div>
                <span className="text-xs text-gray-300">Emails</span>
              </CommandItem>
              
              <CommandItem 
                onSelect={() => setSearch('cal:')} 
                className="flex flex-col items-center gap-2 py-3 px-2 rounded-lg bg-[#161b22] border border-[#30363d] hover:border-blue-500/50 cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-blue-400" />
                </div>
                <span className="text-xs text-gray-300">Calendar</span>
              </CommandItem>
              
              <CommandItem 
                onSelect={() => setSearch('doc:')} 
                className="flex flex-col items-center gap-2 py-3 px-2 rounded-lg bg-[#161b22] border border-[#30363d] hover:border-green-500/50 cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-green-400" />
                </div>
                <span className="text-xs text-gray-300">Documents</span>
              </CommandItem>
            </div>
          </CommandGroup>

          {/* Keyboard shortcuts hint */}
          <div className="mt-4 pt-3 border-t border-[#30363d] flex items-center justify-center gap-4 text-[10px] text-gray-500">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-[#21262d] text-gray-400">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-[#21262d] text-gray-400">↵</kbd>
              Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-[#21262d] text-gray-400">Esc</kbd>
              Close
            </span>
          </div>
        </CommandList>
      </div>
    </CommandDialog>
  );
}
