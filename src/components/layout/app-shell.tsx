'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { MobileNav } from './mobile-nav';
import { CommandPalette } from './command-palette';
import { OmniPanel, OmniPanelButton } from '@/components/chat/omni-panel';
import { HelpOverlay } from './help-overlay';
import { SyncManagerProvider } from '@/lib/sync-manager';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isOmniPanelOpen, setIsOmniPanelOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  // Close mobile nav on route change
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setIsMobileNavOpen(false);
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [pathname]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // CMD+K - Open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
      
      // CMD+B - Toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setIsSidebarCollapsed(prev => !prev);
      }

      // CMD+/ - Help overlay
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setIsHelpOpen(true);
      }
      
      // ESC - Close panels
      if (e.key === 'Escape') {
        if (isCommandPaletteOpen) setIsCommandPaletteOpen(false);
        if (isHelpOpen) setIsHelpOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCommandPaletteOpen, isHelpOpen]);

  // Global event to open Omni-Panel from anywhere
  useEffect(() => {
    const handleOpenOmniPanel = () => setIsOmniPanelOpen(true);
    window.addEventListener('open-omni-panel', handleOpenOmniPanel as EventListener);
    return () => window.removeEventListener('open-omni-panel', handleOpenOmniPanel as EventListener);
  }, []);

  // Responsive sidebar collapse
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsSidebarCollapsed(true);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleOpenCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(true);
  }, []);

  return (
    <SyncManagerProvider>
      <div className="min-h-screen bg-background">
        {/* Desktop Sidebar */}
        <div className="hidden md:block">
          <Sidebar
            isCollapsed={isSidebarCollapsed}
            onToggle={() => setIsSidebarCollapsed(prev => !prev)}
            onOpenCommandPalette={handleOpenCommandPalette}
          />
        </div>

        {/* Mobile Navigation */}
        <MobileNav
          isOpen={isMobileNavOpen}
          onClose={() => setIsMobileNavOpen(false)}
          onOpenCommandPalette={handleOpenCommandPalette}
        />

        {/* Main Content Area */}
        <div
          className={cn(
            'flex flex-col min-h-screen transition-all duration-300',
            'md:ml-60',
            isSidebarCollapsed && 'md:ml-16'
          )}
        >
          <Header
            onOpenCommandPalette={handleOpenCommandPalette}
            onOpenMobileNav={() => setIsMobileNavOpen(true)}
          />

          <main className="flex-1 p-4 md:p-6">
            {children}
          </main>
        </div>

        {/* Command Palette */}
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
        />

        {/* Omni-Panel (Chat) */}
        {isOmniPanelOpen ? (
          <OmniPanel
            isOpen={isOmniPanelOpen}
            onClose={() => setIsOmniPanelOpen(false)}
          />
        ) : (
          <OmniPanelButton onClick={() => setIsOmniPanelOpen(true)} />
        )}

        {/* Help Overlay */}
        <HelpOverlay
          isOpen={isHelpOpen}
          onClose={() => setIsHelpOpen(false)}
        />
      </div>
    </SyncManagerProvider>
  );
}
