'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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

const SIDEBAR_COLLAPSED_KEY = 'emergent-sidebar-collapsed';

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    // Initialize from localStorage if available (only on client)
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (saved !== null) {
        return saved === 'true';
      }
    }
    return false;
  });
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isOmniPanelOpen, setIsOmniPanelOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const userHasToggledRef = useRef(false);

  // Persist sidebar collapsed state to localStorage
  useEffect(() => {
    if (userHasToggledRef.current) {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isSidebarCollapsed));
    }
  }, [isSidebarCollapsed]);

  // Handle sidebar toggle (user action)
  const handleSidebarToggle = useCallback(() => {
    userHasToggledRef.current = true;
    setIsSidebarCollapsed(prev => !prev);
  }, []);

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
        userHasToggledRef.current = true;
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

  // Responsive sidebar collapse - only auto-collapse on initial load if no user preference
  useEffect(() => {
    // Only auto-collapse if user hasn't manually toggled and no saved preference
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (saved === null && !userHasToggledRef.current && window.innerWidth < 1024) {
        setIsSidebarCollapsed(true);
      }
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
            onToggle={handleSidebarToggle}
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
            'md:ml-[260px]',
            isSidebarCollapsed && 'md:ml-[68px]'
          )}
        >
          <Header
            onOpenCommandPalette={handleOpenCommandPalette}
            onOpenMobileNav={() => setIsMobileNavOpen(true)}
          />

          <main className="flex-1 p-4 lg:p-5 overflow-hidden">
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
