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
        'sticky top-0 z-30 h-14 border-b border-[#30363d] bg-[#0d1117]/95 backdrop-blur supports-[backdrop-filter]:bg-[#0d1117]/80',
        'flex items-center justify-between px-4 gap-4',
        'transition-all duration-300'
      )}
    >
      {/* Left Section */}
      <div className="flex items-center gap-3">
        {/* Mobile Menu Button */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden h-9 w-9 text-gray-400 hover:text-white hover:bg-[#21262d]"
          onClick={onOpenMobileNav}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open menu</span>
        </Button>

        {/* Search Button */}
        <Button
          variant="outline"
          className={cn(
            'hidden sm:flex items-center gap-2.5 text-gray-500',
            'h-10 px-4 w-80 justify-start',
            'bg-[#161b22] border-[#30363d] hover:border-[#484f58] hover:bg-[#21262d]',
            'rounded-xl transition-all'
          )}
          onClick={onOpenCommandPalette}
        >
          <Search className="h-4 w-4" />
          <span className="text-sm text-gray-500">Search...</span>
          <kbd className="ml-auto flex h-5 items-center gap-1 rounded-md border border-[#30363d] bg-[#21262d] px-1.5 font-mono text-[10px] font-medium text-gray-500">
            <span className="text-[9px]">⌘</span>K
          </kbd>
        </Button>

        {/* Mobile Search Icon */}
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden h-9 w-9 text-gray-400 hover:text-white hover:bg-[#21262d]"
          onClick={onOpenCommandPalette}
        >
          <Search className="h-5 w-5" />
          <span className="sr-only">Search</span>
        </Button>
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-3">
        {/* User Button */}
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            elements: {
              avatarBox: 'h-9 w-9 ring-2 ring-[#30363d] hover:ring-teal-500/50 transition-all',
            },
          }}
        />
      </div>
    </header>
  );
}
