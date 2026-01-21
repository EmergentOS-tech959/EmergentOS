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
  Sidebar as SidebarIcon,
  Keyboard,
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
      <DialogContent className="sm:max-w-[450px] bg-background border-border rounded-2xl">
        <DialogHeader className="pb-4">
          <DialogTitle className="flex items-center gap-3 text-foreground">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-teal-600/10 flex items-center justify-center ring-1 ring-primary/20">
              <Keyboard className="h-5 w-5 text-primary" />
            </div>
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Boost your productivity with these shortcuts.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-2 py-2">
          {shortcuts.map((item, index) => (
            <div
              key={item.key}
              className="flex items-center justify-between p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors animate-fade-in"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground">
                  <item.icon className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-foreground">{item.description}</span>
              </div>
              <kbd className="h-7 min-w-[3rem] select-none items-center gap-1 rounded-lg border border-border bg-background px-2.5 font-mono text-[11px] font-medium text-muted-foreground flex justify-center">
                {item.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="pt-4 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">
            Press <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground font-mono text-[10px]">⌘ /</kbd> anytime to show this
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
