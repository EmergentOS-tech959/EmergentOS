'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  LayoutDashboard,
  Search,
  Inbox,
  FolderOpen,
  Activity,
  Brain,
  GitBranch,
  Workflow,
  Lock,
  Settings,
  Sparkles,
  PanelLeftClose,
  PanelLeft,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { SourceIndicators } from './source-indicators';

// ============================================================================
// Types
// ============================================================================

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  action?: () => void;
  badge?: string;
  locked?: boolean;
  color: string;
}

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onOpenCommandPalette?: () => void;
}

// ============================================================================
// Constants
// ============================================================================

// Timing constants
const TRANSITION_DELAY_BASE = 120;
const TRANSITION_DELAY_ITEM = 35;

// Layout constants - FIXED in both collapsed and expanded states
const ITEM_HEIGHT = 'h-11';        // 44px item height
const ITEM_PADDING = 'px-3';       // Horizontal padding (always same)
const ITEM_GAP = 'gap-3';          // Gap between icon and label
const ITEM_SPACING = 'space-y-1';  // Vertical spacing between items
const ICON_SIZE = 'w-8 h-8';       // 32px icon container
const ICON_INNER = 'h-[18px] w-[18px]'; // 18px icon

// ============================================================================
// Navigation Data
// ============================================================================

const createNavItems = (onOpenCommandPalette?: () => void): NavItem[] => [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    href: '/dashboard',
    color: 'teal',
  },
  {
    id: 'search',
    label: 'Search',
    icon: Search,
    action: onOpenCommandPalette,
    color: 'sky',
  },
  {
    id: 'inbox',
    label: 'Unified Inbox',
    icon: Inbox,
    href: '/inbox',
    badge: 'new',
    color: 'violet',
  },
  {
    id: 'resources',
    label: 'Resources',
    icon: FolderOpen,
    href: '/resources',
    color: 'amber',
  },
];

const LOCKED_ITEMS: NavItem[] = [
  { id: 'pulse', label: 'Pulse', icon: Activity, locked: true, color: 'gray' },
  { id: 'intelligence', label: 'Intelligence', icon: Brain, locked: true, color: 'gray' },
  { id: 'decisions', label: 'Decisions', icon: GitBranch, locked: true, color: 'gray' },
  { id: 'workflows', label: 'Workflows', icon: Workflow, locked: true, color: 'gray' },
  { id: 'vault', label: 'Knowledge Vault', icon: Lock, locked: true, color: 'gray' },
];

const SETTINGS_ITEM: NavItem = {
  id: 'settings',
  label: 'Settings',
  icon: Settings,
  href: '/settings',
  color: 'slate',
};

// ============================================================================
// Utility Functions
// ============================================================================

const getColorClasses = (color: string, isActive: boolean, isLocked?: boolean) => {
  if (isLocked) {
    return {
      icon: 'text-muted-foreground/40',
      text: 'text-muted-foreground/40',
      accent: 'bg-muted-foreground/40',
      gradient: '',
    };
  }

  const colors: Record<string, { icon: string; accent: string; gradient: string }> = {
    teal: {
      icon: 'text-teal-400',
      accent: 'bg-teal-400',
      gradient: 'from-teal-500/15 to-teal-500/5',
    },
    sky: {
      icon: 'text-sky-400',
      accent: 'bg-sky-400',
      gradient: 'from-sky-500/15 to-sky-500/5',
    },
    violet: {
      icon: 'text-violet-400',
      accent: 'bg-violet-400',
      gradient: 'from-violet-500/15 to-violet-500/5',
    },
    amber: {
      icon: 'text-amber-400',
      accent: 'bg-amber-400',
      gradient: 'from-amber-500/15 to-amber-500/5',
    },
    slate: {
      icon: 'text-slate-400',
      accent: 'bg-slate-400',
      gradient: 'from-slate-500/15 to-slate-500/5',
    },
    gray: {
      icon: 'text-muted-foreground/50',
      accent: 'bg-muted-foreground/50',
      gradient: '',
    },
  };

  const colorSet = colors[color] || colors.gray;

  return {
    icon: isActive ? colorSet.icon : 'text-muted-foreground group-hover:text-foreground/90',
    text: isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground',
    accent: colorSet.accent,
    gradient: colorSet.gradient,
  };
};

// ============================================================================
// Sub-Components
// ============================================================================

interface NavItemContentProps {
  item: NavItem;
  isActive: boolean;
  isCollapsed: boolean;
  isLabelVisible: boolean;
}

function NavItemContent({ item, isActive, isCollapsed, isLabelVisible }: NavItemContentProps) {
  const Icon = item.icon;
  const colors = getColorClasses(item.color, isActive, item.locked);

  return (
    <div
      className={cn(
        // Core layout
        'group relative flex items-center rounded-lg cursor-pointer',
        ITEM_HEIGHT,
        // Centered when collapsed, left-aligned when expanded
        'transition-all duration-300 ease-out',
        isCollapsed ? 'justify-center px-0' : `justify-start ${ITEM_PADDING} ${ITEM_GAP}`,
        // Background states
        isActive && !item.locked && `bg-gradient-to-r ${colors.gradient}`,
        !isActive && !item.locked && 'hover:bg-white/[0.04]',
        // Locked state
        item.locked && 'opacity-50 cursor-not-allowed'
      )}
    >
      {/* Active indicator bar */}
      {isActive && !item.locked && (
        <div
          className={cn(
            'absolute left-0 top-1/2 -translate-y-1/2',
            'w-[2px] h-5 rounded-r-full',
            colors.accent,
            'transition-opacity duration-300',
            isCollapsed ? 'opacity-0' : 'opacity-100'
          )}
        />
      )}

      {/* Icon container - FIXED size, centered positioning */}
      <div
        className={cn(
          'relative flex items-center justify-center rounded-md shrink-0',
          ICON_SIZE,
          'transition-all duration-300',
          isActive && !item.locked && 'bg-white/[0.06]',
          !isActive && !item.locked && 'group-hover:bg-white/[0.04]'
        )}
      >
        <Icon
          className={cn(
            ICON_INNER,
            'transition-colors duration-200',
            colors.icon
          )}
        />

        {/* Lock badge for locked items */}
        {item.locked && (
          <div
            className={cn(
              'absolute -top-0.5 -right-0.5',
              'w-3.5 h-3.5 rounded-full',
              'bg-background border border-border/50',
              'flex items-center justify-center',
              'transition-opacity duration-300',
              isCollapsed ? 'opacity-0' : 'opacity-100'
            )}
          >
            <Lock className="h-2 w-2 text-muted-foreground/60" />
          </div>
        )}
      </div>

      {/* Label section - slides in/out */}
      <div
        className={cn(
          'flex items-center justify-between min-w-0',
          'transition-all duration-300 ease-out overflow-hidden',
          isCollapsed 
            ? 'w-0 opacity-0' 
            : 'flex-1 opacity-100',
          !isCollapsed && !isLabelVisible && 'opacity-0'
        )}
      >
        <span
          className={cn(
            'text-[13px] font-medium truncate whitespace-nowrap',
            'transition-colors duration-200',
            colors.text
          )}
        >
          {item.label}
        </span>

        {/* Accessories */}
        <div className="flex items-center gap-2 ml-2 shrink-0">
          {item.badge && (
            <span
              className={cn(
                'px-1.5 py-0.5 rounded',
                'text-[9px] font-semibold uppercase tracking-wide',
                'bg-teal-500/15 text-teal-400 border border-teal-500/20'
              )}
            >
              {item.badge}
            </span>
          )}

          {item.id === 'search' && (
            <kbd
              className={cn(
                'hidden lg:flex items-center gap-0.5',
                'text-[10px] px-1.5 py-0.5 rounded',
                'bg-white/[0.04] border border-white/[0.08]',
                'text-muted-foreground font-mono'
              )}
            >
              <span className="text-[9px]">⌘</span>K
            </kbd>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function Sidebar({ isCollapsed, onToggle, onOpenCommandPalette }: SidebarProps) {
  const pathname = usePathname();
  const timersRef = useRef<NodeJS.Timeout[]>([]);

  // Animation states
  const [showLabels, setShowLabels] = useState(!isCollapsed);
  const [visibleCount, setVisibleCount] = useState(isCollapsed ? 0 : 99);

  // Navigation items with action bound
  const navItems = createNavItems(onOpenCommandPalette);
  const totalItems = navItems.length + LOCKED_ITEMS.length + 1; // +1 for settings

  // Clear timers utility
  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  // Handle expand/collapse transitions
  useEffect(() => {
    clearTimers();

    if (isCollapsed) {
      // Instant collapse
      setShowLabels(false);
      setVisibleCount(0);
    } else {
      // Staggered expand
      const labelsTimer = setTimeout(() => {
        setShowLabels(true);
      }, TRANSITION_DELAY_BASE);
      timersRef.current.push(labelsTimer);

      for (let i = 1; i <= totalItems + 2; i++) {
        const timer = setTimeout(() => {
          setVisibleCount(i);
        }, TRANSITION_DELAY_BASE + i * TRANSITION_DELAY_ITEM);
        timersRef.current.push(timer);
      }
    }

    return clearTimers;
  }, [isCollapsed, clearTimers, totalItems]);

  // Locked item click handler
  const handleLockedClick = useCallback((label: string) => {
    toast.info(`${label} — Coming in Phase 2`, {
      description: 'This feature is not available yet.',
      duration: 2500,
    });
  }, []);

  // Render navigation item with proper wrapper
  const renderNavItem = useCallback(
    (item: NavItem, index: number) => {
      const isActive = item.href ? pathname === item.href : false;
      const isLabelVisible = index < visibleCount;

      const content = (
        <NavItemContent
          item={item}
          isActive={isActive}
          isCollapsed={isCollapsed}
          isLabelVisible={isLabelVisible}
        />
      );

      const tooltipContent = (
        <TooltipContent side="right" sideOffset={12} className="glass border-border/60 px-3 py-2">
          {item.locked ? (
            <div className="flex items-center gap-2">
              <Lock className="h-3 w-3 text-muted-foreground/60" />
              <div>
                <p className="text-foreground font-medium text-sm">{item.label}</p>
                <p className="text-[10px] text-muted-foreground">Phase 2</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <p className="text-foreground font-medium text-sm">{item.label}</p>
              {item.id === 'search' && (
                <kbd className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.1] text-muted-foreground font-mono">
                  <span className="text-[9px]">⌘</span>K
                </kbd>
              )}
            </div>
          )}
        </TooltipContent>
      );

      // Locked items
      if (item.locked) {
        return (
          <div key={item.id} onClick={() => handleLockedClick(item.label)}>
            {isCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{content}</TooltipTrigger>
                {tooltipContent}
              </Tooltip>
            ) : (
              content
            )}
          </div>
        );
      }

      // Action items
      if (item.action) {
        return (
          <div key={item.id} onClick={item.action}>
            {isCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{content}</TooltipTrigger>
                {tooltipContent}
              </Tooltip>
            ) : (
              content
            )}
          </div>
        );
      }

      // Link items
      if (item.href) {
        return (
          <Link key={item.id} href={item.href}>
            {isCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{content}</TooltipTrigger>
                {tooltipContent}
              </Tooltip>
            ) : (
              content
            )}
          </Link>
        );
      }

      return <div key={item.id}>{content}</div>;
    },
    [pathname, isCollapsed, visibleCount, handleLockedClick]
  );

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 h-screen',
          'bg-gradient-to-b from-[#0d1117] via-[#0c0f14] to-[#0a0c10]',
          'border-r border-white/[0.06]',
          'flex flex-col',
          'transition-[width] duration-300 ease-out',
          isCollapsed ? 'w-[68px]' : 'w-[260px]'
        )}
      >
        {/* Top highlight line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

        {/* ================================================================ */}
        {/* Logo Section */}
        {/* ================================================================ */}
        <div
          className={cn(
            'relative flex items-center h-16 px-4 border-b border-white/[0.06]',
            isCollapsed ? 'justify-center' : 'gap-2'
          )}
        >
          {/* Logo icon */}
          <div className="relative group cursor-pointer shrink-0">
            <div
              className={cn(
                'absolute -inset-1 rounded-full blur-lg',
                'bg-teal-500/30',
                'opacity-60 group-hover:opacity-100',
                'transition-opacity duration-300',
                'animate-pulse'
              )}
              style={{ animationDuration: '3s' }}
            />
            <div className="relative h-9 w-9 flex items-center justify-center">
              <Image
                src="/logo.png"
                alt="EmergentOS"
                width={36}
                height={36}
                className="object-contain brightness-0 invert drop-shadow-[0_0_8px_rgba(20,184,166,0.5)]"
                priority
              />
            </div>
          </div>

          {/* Logo text */}
          {!isCollapsed && (
            <div
              className={cn(
                'flex items-end gap-1 min-w-0',
                'transition-all duration-200',
                showLabels && visibleCount > 0
                  ? 'opacity-100 translate-x-0'
                  : 'opacity-0 -translate-x-2'
              )}
            >
              <span className="text-xl font-semibold text-foreground tracking-tight leading-none mb-1.5">
                mergentOS
              </span>
            </div>
          )}
        </div>

        {/* ================================================================ */}
        {/* Navigation */}
        {/* ================================================================ */}
        <nav className="flex-1 px-2 py-3 overflow-y-auto eos-scrollbar-thin">
          {/* Main navigation */}
          <div className={ITEM_SPACING}>
            {navItems.map((item, i) => renderNavItem(item, i))}
          </div>

          {/* Separator */}
          <div className="my-3 mx-1">
            <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
          </div>

          {/* Locked items section */}
          <div className={ITEM_SPACING}>
            {/* Section header - collapses with sidebar */}
            <div
              className={cn(
                'flex items-center h-8 overflow-hidden',
                'transition-all duration-300 ease-out',
                isCollapsed ? 'justify-center px-0 opacity-0' : 'justify-start gap-3 px-3 opacity-100',
                !isCollapsed && showLabels && visibleCount > navItems.length
                  ? 'opacity-100'
                  : 'opacity-0'
              )}
            >
              <Lock className="h-3 w-3 text-muted-foreground/40 shrink-0" />
              <span 
                className={cn(
                  'text-[10px] uppercase tracking-widest text-muted-foreground/50 font-semibold whitespace-nowrap',
                  'transition-all duration-300 overflow-hidden',
                  isCollapsed ? 'w-0 opacity-0' : 'opacity-100'
                )}
              >
                Coming Soon
              </span>
            </div>
            {LOCKED_ITEMS.map((item, i) => renderNavItem(item, navItems.length + i + 1))}
          </div>

          {/* Separator */}
          <div className="my-3 mx-1">
            <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
          </div>

          {/* Settings */}
          <div className={ITEM_SPACING}>
            {renderNavItem(SETTINGS_ITEM, navItems.length + LOCKED_ITEMS.length + 1)}
          </div>
        </nav>

        {/* ================================================================ */}
        {/* Source Indicators */}
        {/* ================================================================ */}
        <SourceIndicators isCollapsed={isCollapsed} />

        {/* ================================================================ */}
        {/* Collapse Toggle */}
        {/* ================================================================ */}
        <div className="p-2 border-t border-white/[0.06]">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggle}
                className={cn(
                  // Fixed height to match nav items
                  'w-full h-11 rounded-lg',
                  'text-muted-foreground hover:text-foreground',
                  'bg-white/[0.02] hover:bg-white/[0.05]',
                  'border border-white/[0.04] hover:border-white/[0.08]',
                  'transition-all duration-300 ease-out',
                  // Center when collapsed, left-align when expanded
                  isCollapsed ? 'justify-center px-0' : 'justify-start px-3 gap-3'
                )}
              >
                <div className={cn('flex items-center justify-center shrink-0', ICON_SIZE)}>
                  {isCollapsed ? (
                    <PanelLeft className={ICON_INNER} />
                  ) : (
                    <PanelLeftClose className={ICON_INNER} />
                  )}
                </div>
                <span
                  className={cn(
                    'text-[13px] font-medium whitespace-nowrap',
                    'transition-all duration-300 ease-out overflow-hidden',
                    isCollapsed ? 'opacity-0 w-0' : 'opacity-100',
                    !isCollapsed && showLabels && visibleCount > totalItems
                      ? 'opacity-100'
                      : 'opacity-0'
                  )}
                >
                  Collapse
                </span>
              </Button>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right" sideOffset={12} className="glass border-border/60 px-3 py-2">
                <p className="text-foreground font-medium text-sm">Expand sidebar</p>
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}
