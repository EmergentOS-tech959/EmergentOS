'use client';

import { UserButton } from '@clerk/nextjs';
import { Search, Menu, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface HeaderProps {
  onOpenCommandPalette?: () => void;
  onOpenMobileNav?: () => void;
  onToggleOmniPanel?: () => void;
}

export function Header({ 
  onOpenCommandPalette, 
  onOpenMobileNav,
  onToggleOmniPanel,
}: HeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        'flex items-center justify-between px-4 gap-4',
        'transition-all duration-300'
      )}
    >
      {/* Left Section */}
      <div className="flex items-center gap-2">
        {/* Mobile Menu Button */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onOpenMobileNav}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open menu</span>
        </Button>

        {/* Search Button */}
        <Button
          variant="outline"
          className={cn(
            'hidden sm:flex items-center gap-2 text-muted-foreground',
            'h-9 px-3 w-64 justify-start'
          )}
          onClick={onOpenCommandPalette}
        >
          <Search className="h-4 w-4" />
          <span className="text-sm">Search...</span>
          <kbd className="ml-auto pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
            <span className="text-xs">⌘</span>K
          </kbd>
        </Button>

        {/* Mobile Search Icon */}
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          onClick={onOpenCommandPalette}
        >
          <Search className="h-5 w-5" />
          <span className="sr-only">Search</span>
        </Button>
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-2">
        {/* Omni-Panel Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleOmniPanel}
          className="relative"
        >
          <MessageSquare className="h-5 w-5" />
          <span className="sr-only">Open chat</span>
          {/* Active indicator */}
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary animate-pulse" />
        </Button>

        {/* User Button */}
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            elements: {
              avatarBox: 'h-8 w-8 ring-2 ring-border hover:ring-primary/50 transition-all',
            },
          }}
        />
      </div>
    </header>
  );
}
