'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
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
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { SourceIndicators } from './source-indicators';

interface SidebarItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  action?: () => void;
  badge?: string | number;
  isLocked?: boolean;
  accentColor: string;
  activeGradient: string;
}

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onOpenCommandPalette?: () => void;
}

export function Sidebar({ isCollapsed, onToggle, onOpenCommandPalette }: SidebarProps) {
  const pathname = usePathname();

  const handleLockedClick = (label: string) => {
    toast.info(`${label} — Coming in Phase 2`, {
      description: 'This feature is not available yet.',
      duration: 2500,
    });
  };

  const sidebarItems: SidebarItem[] = [
    { 
      id: 'dashboard', 
      label: 'Dashboard', 
      icon: LayoutDashboard, 
      href: '/dashboard', 
      accentColor: 'text-teal-400',
      activeGradient: 'from-teal-500/15 to-teal-500/5'
    },
    { 
      id: 'search', 
      label: 'Search', 
      icon: Search, 
      action: onOpenCommandPalette, 
      accentColor: 'text-sky-400',
      activeGradient: 'from-sky-500/15 to-sky-500/5'
    },
    { 
      id: 'inbox', 
      label: 'Unified Inbox', 
      icon: Inbox, 
      href: '/inbox', 
      badge: 'new', 
      accentColor: 'text-violet-400',
      activeGradient: 'from-violet-500/15 to-violet-500/5'
    },
    { 
      id: 'resources', 
      label: 'Resources', 
      icon: FolderOpen, 
      href: '/resources', 
      accentColor: 'text-amber-400',
      activeGradient: 'from-amber-500/15 to-amber-500/5'
    },
  ];

  const lockedItems: SidebarItem[] = [
    { id: 'pulse', label: 'Pulse', icon: Activity, isLocked: true, accentColor: 'text-muted-foreground/50', activeGradient: '' },
    { id: 'intelligence', label: 'Intelligence', icon: Brain, isLocked: true, accentColor: 'text-muted-foreground/50', activeGradient: '' },
    { id: 'decisions', label: 'Decisions', icon: GitBranch, isLocked: true, accentColor: 'text-muted-foreground/50', activeGradient: '' },
    { id: 'workflows', label: 'Workflows', icon: Workflow, isLocked: true, accentColor: 'text-muted-foreground/50', activeGradient: '' },
    { id: 'vault', label: 'Knowledge Vault', icon: Lock, isLocked: true, accentColor: 'text-muted-foreground/50', activeGradient: '' },
  ];

  const settingsItem: SidebarItem = { 
    id: 'settings', 
    label: 'Settings', 
    icon: Settings, 
    href: '/settings', 
    accentColor: 'text-slate-400',
    activeGradient: 'from-slate-500/15 to-slate-500/5'
  };

  const renderNavItem = (item: SidebarItem) => {
    const isActive = item.href ? pathname === item.href : false;
    const Icon = item.icon;

    const itemContent = (
      <div
        className={cn(
          'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer',
          'transition-all duration-200 ease-out',
          // Active state with gradient background
          isActive && !item.isLocked && `bg-gradient-to-r ${item.activeGradient}`,
          // Hover state
          !isActive && !item.isLocked && 'hover:bg-white/[0.04]',
          // Locked state
          item.isLocked && 'opacity-50 cursor-not-allowed',
          // Collapsed state
          isCollapsed && 'justify-center px-2.5'
        )}
      >
        {/* Active indicator - left accent bar */}
        {isActive && !item.isLocked && (
          <div className={cn(
            'absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-r-full',
            item.accentColor.replace('text-', 'bg-')
          )} />
        )}
        
        {/* Icon */}
        <div className={cn(
          'relative flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200',
          isActive && !item.isLocked && 'bg-white/[0.06]',
          !isActive && !item.isLocked && 'group-hover:bg-white/[0.04]'
        )}>
          <Icon className={cn(
            'h-[18px] w-[18px] transition-all duration-200',
            isActive && !item.isLocked && item.accentColor,
            !isActive && !item.isLocked && 'text-muted-foreground group-hover:text-foreground/90',
            item.isLocked && 'text-muted-foreground/50'
          )} />
          
          {/* Lock indicator for locked items */}
          {item.isLocked && !isCollapsed && (
            <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-background border border-border/50 flex items-center justify-center">
              <Lock className="h-1.5 w-1.5 text-muted-foreground/60" />
            </div>
          )}
        </div>
        
        {/* Label and accessories */}
        {!isCollapsed && (
          <div className="flex-1 flex items-center justify-between min-w-0">
            <span className={cn(
              'text-[13px] font-medium truncate transition-colors duration-200',
              isActive && !item.isLocked && 'text-foreground',
              !isActive && !item.isLocked && 'text-muted-foreground group-hover:text-foreground',
              item.isLocked && 'text-muted-foreground/50'
            )}>
              {item.label}
            </span>
            
            <div className="flex items-center gap-2 ml-2">
              {item.badge && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-teal-500/15 text-teal-400 border border-teal-500/20">
                  {item.badge}
                </span>
              )}
              
              {item.id === 'search' && (
                <kbd className="hidden lg:flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-muted-foreground font-mono">
                  <span className="text-[9px]">⌘</span>K
                </kbd>
              )}
            </div>
          </div>
        )}
      </div>
    );

    // Locked items
    if (item.isLocked) {
      return (
        <div key={item.id} onClick={() => handleLockedClick(item.label)}>
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{itemContent}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={10} className="glass border-border/60 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Lock className="h-3 w-3 text-muted-foreground/60" />
                  <div>
                    <p className="text-foreground font-medium text-sm">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground">Phase 2</p>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            itemContent
          )}
        </div>
      );
    }

    // Action items (search, etc.)
    if (item.action) {
      return (
        <div key={item.id} onClick={item.action}>
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{itemContent}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={10} className="glass border-border/60 px-3 py-2">
                <div className="flex items-center gap-3">
                  <p className="text-foreground font-medium text-sm">{item.label}</p>
                  {item.id === 'search' && (
                    <kbd className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.1] text-muted-foreground font-mono">
                      <span className="text-[9px]">⌘</span>K
                    </kbd>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            itemContent
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
              <TooltipTrigger asChild>{itemContent}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={10} className="glass border-border/60 px-3 py-2">
                <p className="text-foreground font-medium text-sm">{item.label}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            itemContent
          )}
        </Link>
      );
    }

    return <div key={item.id}>{itemContent}</div>;
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 h-screen',
          'bg-gradient-to-b from-[#0d1117] via-[#0c0f14] to-[#0a0c10]',
          'border-r border-white/[0.06]',
          'flex flex-col transition-all duration-300 ease-out',
          isCollapsed ? 'w-[68px]' : 'w-[260px]'
        )}
      >
        {/* Subtle top highlight */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
        
        {/* Logo Section */}
        <div className={cn(
          'relative flex items-center h-16 px-4 border-b border-white/[0.06]',
          isCollapsed ? 'justify-center' : 'gap-3'
        )}>
          {/* Logo with glow effect */}
          <div className="relative group cursor-pointer">
            <div className={cn(
              'absolute -inset-0.5 rounded-xl blur-md transition-opacity duration-300',
              'bg-gradient-to-br from-teal-400/40 to-teal-600/40',
              'opacity-0 group-hover:opacity-100'
            )} />
            <div className={cn(
              'relative h-9 w-9 rounded-xl',
              'bg-gradient-to-br from-teal-400 to-teal-600',
              'flex items-center justify-center',
              'shadow-lg shadow-teal-500/20',
              'transition-transform duration-200 group-hover:scale-[1.02]'
            )}>
              <Sparkles className="h-4.5 w-4.5 text-white" />
            </div>
          </div>
          
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-[15px] font-semibold text-foreground tracking-tight">
                EmergentOS
              </span>
              <span className="text-[10px] text-teal-400/80 font-medium tracking-wide">
                Phase 1 Alpha
              </span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2.5 py-4 overflow-y-auto eos-scrollbar-thin">
          {/* Main navigation */}
          <div className="space-y-0.5">
            {sidebarItems.map(renderNavItem)}
          </div>
          
          {/* Separator */}
          <div className="my-4 mx-2">
            <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
          </div>
          
          {/* Locked items section */}
          <div className="space-y-0.5">
            {!isCollapsed && (
              <div className="flex items-center gap-2 px-3 py-2">
                <Lock className="h-3 w-3 text-muted-foreground/40" />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-semibold">
                  Coming Soon
                </span>
              </div>
            )}
            {lockedItems.map(renderNavItem)}
          </div>
          
          {/* Separator */}
          <div className="my-4 mx-2">
            <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
          </div>
          
          {/* Settings */}
          <div className="space-y-0.5">
            {renderNavItem(settingsItem)}
          </div>
        </nav>

        {/* Source Indicators */}
        <SourceIndicators isCollapsed={isCollapsed} />

        {/* Collapse Toggle */}
        <div className="p-2.5 border-t border-white/[0.06]">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggle}
                className={cn(
                  'w-full h-9 rounded-lg',
                  'text-muted-foreground hover:text-foreground',
                  'bg-white/[0.02] hover:bg-white/[0.05]',
                  'border border-white/[0.04] hover:border-white/[0.08]',
                  'transition-all duration-200',
                  isCollapsed ? 'justify-center' : 'justify-start px-3'
                )}
              >
                {isCollapsed ? (
                  <PanelLeft className="h-4 w-4" />
                ) : (
                  <>
                    <PanelLeftClose className="h-4 w-4 mr-2" />
                    <span className="text-xs font-medium">Collapse</span>
                  </>
                )}
              </Button>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right" sideOffset={10} className="glass border-border/60 px-3 py-2">
                <p className="text-foreground font-medium text-sm">Expand sidebar</p>
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}
