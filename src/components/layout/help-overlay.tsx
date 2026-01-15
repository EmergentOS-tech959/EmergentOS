'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Command,
  Search,
  MessageSquare,
  Sidebar as SidebarIcon,
  Keyboard,
  Settings,
} from 'lucide-react';

interface HelpOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpOverlay({ isOpen, onClose }: HelpOverlayProps) {
  const shortcuts = [
    { key: '⌘ K', description: 'Open command palette', icon: Search },
    { key: '⌘ B', description: 'Toggle sidebar', icon: SidebarIcon },
    { key: '⌘ /', description: 'Show keyboard shortcuts', icon: Keyboard },
    { key: 'ESC', description: 'Close active panel/modal', icon: Command },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Boost your productivity with these shortcuts.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          {shortcuts.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-md bg-secondary flex items-center justify-center text-muted-foreground">
                  <item.icon className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium">{item.description}</span>
              </div>
              <kbd className="pointer-events-none h-6 select-none items-center gap-1 rounded border bg-muted px-2 font-mono text-[10px] font-medium opacity-100 flex min-w-[3rem] justify-center">
                {item.key}
              </kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
