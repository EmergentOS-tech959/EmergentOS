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
  MessageSquare,
  RefreshCw,
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

  const navigationItems = [
    {
      icon: LayoutDashboard,
      label: 'Dashboard',
      shortcut: '⌘D',
      action: () => router.push('/dashboard'),
    },
    {
      icon: Inbox,
      label: 'Unified Inbox',
      shortcut: '⌘I',
      action: () => router.push('/inbox'),
    },
    {
      icon: FolderOpen,
      label: 'Resources',
      shortcut: '⌘R',
      action: () => router.push('/resources'),
    },
    {
      icon: Settings,
      label: 'Settings',
      shortcut: '⌘,',
      action: () => router.push('/settings'),
    },
  ];

  const actionItems = [
    {
      icon: RefreshCw,
      label: 'Refresh Briefing',
      description: 'Generate a new daily briefing',
      action: () => {
        // TODO: Implement briefing refresh
        console.log('Refresh briefing');
      },
    },
    {
      icon: MessageSquare,
      label: 'Ask AI Assistant',
      description: 'Open chat with your data',
      action: () => {
        // TODO: Open Omni-Panel
        console.log('Open chat');
      },
    },
  ];

  const searchCategories = [
    { icon: Mail, label: 'Search Emails', prefix: 'email:' },
    { icon: Calendar, label: 'Search Calendar', prefix: 'cal:' },
    { icon: FileText, label: 'Search Documents', prefix: 'doc:' },
  ];

  return (
    <CommandDialog open={isOpen} onOpenChange={onClose}>
      <CommandInput
        placeholder="Type a command or search..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>
          <div className="flex flex-col items-center gap-2 py-6">
            <Search className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No results found.</p>
            <p className="text-xs text-muted-foreground">
              Try searching for emails, events, or documents.
            </p>
          </div>
        </CommandEmpty>

        <CommandGroup heading="Navigation">
          {navigationItems.map((item) => (
            <CommandItem
              key={item.label}
              onSelect={() => handleSelect(item.action)}
              className="flex items-center gap-2"
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
              {item.shortcut && (
                <kbd className="ml-auto text-xs text-muted-foreground">
                  {item.shortcut}
                </kbd>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          {actionItems.map((item) => (
            <CommandItem
              key={item.label}
              onSelect={() => handleSelect(item.action)}
              className="flex items-center gap-2"
            >
              <item.icon className="h-4 w-4" />
              <div className="flex flex-col">
                <span>{item.label}</span>
                <span className="text-xs text-muted-foreground">
                  {item.description}
                </span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Search In">
          {searchCategories.map((item) => (
            <CommandItem
              key={item.label}
              onSelect={() => setSearch(item.prefix)}
              className="flex items-center gap-2"
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
              <span className="ml-auto text-xs text-muted-foreground font-mono">
                {item.prefix}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
