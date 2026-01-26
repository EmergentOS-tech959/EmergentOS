'use client';

import { UserButton } from '@clerk/nextjs';
import { Search, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface HeaderProps {
  onOpenCommandPalette?: () => void;
  onOpenMobileNav?: () => void;
}

export function Header({ 
  onOpenCommandPalette, 
  onOpenMobileNav,
}: HeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 h-16 border-b border-border',
        'bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60',
        'flex items-center justify-between px-4 md:px-6 gap-4',
        'transition-all duration-300'
      )}
    >
      {/* Left Section */}
      <div className="flex items-center gap-3">
        {/* Mobile Menu Button */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-xl transition-all duration-200"
          onClick={onOpenMobileNav}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open menu</span>
        </Button>

        {/* Search Button - Desktop */}
        <Button
          variant="outline"
          className={cn(
            'hidden sm:flex items-center gap-3 text-muted-foreground',
            'h-11 px-4 w-80 justify-start',
            'bg-secondary/50 border-border hover:border-primary/30 hover:bg-secondary',
            'rounded-xl transition-all duration-200',
            'focus-glow'
          )}
          onClick={onOpenCommandPalette}
        >
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Search anything...</span>
          <kbd className="ml-auto flex h-6 items-center gap-1 rounded-md border border-border bg-background/50 px-2 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="text-[10px]">⌘</span>K
          </kbd>
        </Button>

        {/* Mobile Search Icon */}
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-xl transition-all duration-200"
          onClick={onOpenCommandPalette}
        >
          <Search className="h-5 w-5" />
          <span className="sr-only">Search</span>
        </Button>
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-3">
        {/* User Button */}
        <div className="relative">
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            elements: {
                avatarBox: cn(
                  'h-10 w-10',
                  'ring-2 ring-border hover:ring-primary/50',
                  'transition-all duration-200'
                ),
            },
          }}
        />
        </div>
      </div>
    </header>
  );
}
