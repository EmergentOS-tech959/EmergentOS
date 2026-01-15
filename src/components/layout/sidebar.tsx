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
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';

interface SidebarItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  action?: () => void;
  badge?: string | number;
  isLocked?: boolean;
}

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onOpenCommandPalette?: () => void;
}

export function Sidebar({ isCollapsed, onToggle, onOpenCommandPalette }: SidebarProps) {
  const pathname = usePathname();

  const handleLockedClick = (label: string) => {
    toast.info(`${label} is locked in Alpha Phase`, {
      description: 'This feature will be available in Phase 2.',
      duration: 3000,
    });
  };

  const sidebarItems: SidebarItem[] = [
    // Core Navigation (Active)
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
    { id: 'search', label: 'Search', icon: Search, action: onOpenCommandPalette },
    { id: 'inbox', label: 'Unified Inbox', icon: Inbox, href: '/inbox', badge: 'new' },
    { id: 'resources', label: 'Resources', icon: FolderOpen, href: '/resources' },
  ];

  const lockedItems: SidebarItem[] = [
    { id: 'pulse', label: 'Pulse', icon: Activity, isLocked: true },
    { id: 'intelligence', label: 'Intelligence', icon: Brain, isLocked: true },
    { id: 'decisions', label: 'Decisions', icon: GitBranch, isLocked: true },
    { id: 'workflows', label: 'Workflows', icon: Workflow, isLocked: true },
    { id: 'vault', label: 'Knowledge Vault', icon: Lock, isLocked: true },
  ];

  const settingsItems: SidebarItem[] = [
    { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
  ];

  const renderNavItem = (item: SidebarItem) => {
    const isActive = item.href ? pathname === item.href : false;
    const Icon = item.icon;

    const itemContent = (
      <div
        className={cn(
          'flex items-center gap-3 px-3 py-2 rounded transition-colors-fast cursor-pointer',
          'hover:bg-secondary',
          isActive && 'bg-secondary text-primary',
          item.isLocked && 'opacity-50 cursor-not-allowed',
          isCollapsed && 'justify-center px-2'
        )}
      >
        <div className="relative">
          <Icon className={cn('h-5 w-5', isActive && 'text-primary')} />
          {item.isLocked && !isCollapsed && (
            <Lock className="h-2.5 w-2.5 absolute -top-1 -right-1 text-muted-foreground" />
          )}
        </div>
        {!isCollapsed && (
          <>
            <span className={cn('flex-1 text-sm', isActive && 'font-medium')}>
              {item.label}
            </span>
            {item.badge && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                {item.badge}
              </span>
            )}
          </>
        )}
      </div>
    );

    if (item.isLocked) {
      return (
        <div key={item.id} onClick={() => handleLockedClick(item.label)}>
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{itemContent}</TooltipTrigger>
              <TooltipContent side="right">
                <p>{item.label} (Locked)</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            itemContent
          )}
        </div>
      );
    }

    if (item.action) {
      return (
        <div key={item.id} onClick={item.action}>
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{itemContent}</TooltipTrigger>
              <TooltipContent side="right">
                <p>{item.label}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            itemContent
          )}
        </div>
      );
    }

    if (item.href) {
      return (
        <Link key={item.id} href={item.href}>
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{itemContent}</TooltipTrigger>
              <TooltipContent side="right">
                <p>{item.label}</p>
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
          'fixed left-0 top-0 z-40 h-screen bg-sidebar border-r border-sidebar-border',
          'flex flex-col transition-all duration-300 ease-out',
          isCollapsed ? 'w-16' : 'w-60'
        )}
      >
        {/* Logo */}
        <div className={cn(
          'flex items-center h-14 px-3 border-b border-sidebar-border',
          isCollapsed ? 'justify-center' : 'gap-2'
        )}>
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-primary-foreground font-bold text-sm">E</span>
          </div>
          {!isCollapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">EmergentOS</span>
              <span className="text-[10px] text-muted-foreground">Phase 1 Alpha</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto eos-scrollbar">
          {sidebarItems.map(renderNavItem)}
          
          <Separator className="my-4" />
          
          {lockedItems.map(renderNavItem)}
          
          <Separator className="my-4" />
          
          {settingsItems.map(renderNavItem)}
        </nav>

        {/* Collapse Toggle */}
        <div className="p-2 border-t border-sidebar-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className={cn(
              'w-full justify-center',
              !isCollapsed && 'justify-start'
            )}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 mr-2" />
                <span className="text-xs">Collapse</span>
              </>
            )}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
