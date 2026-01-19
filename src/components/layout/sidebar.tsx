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
import { SourceIndicators } from './source-indicators';

interface SidebarItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  action?: () => void;
  badge?: string | number;
  isLocked?: boolean;
  color?: string;
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
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard', color: 'text-teal-400' },
    { id: 'search', label: 'Search', icon: Search, action: onOpenCommandPalette, color: 'text-blue-400' },
    { id: 'inbox', label: 'Unified Inbox', icon: Inbox, href: '/inbox', badge: 'new', color: 'text-purple-400' },
    { id: 'resources', label: 'Resources', icon: FolderOpen, href: '/resources', color: 'text-green-400' },
  ];

  const lockedItems: SidebarItem[] = [
    { id: 'pulse', label: 'Pulse', icon: Activity, isLocked: true },
    { id: 'intelligence', label: 'Intelligence', icon: Brain, isLocked: true },
    { id: 'decisions', label: 'Decisions', icon: GitBranch, isLocked: true },
    { id: 'workflows', label: 'Workflows', icon: Workflow, isLocked: true },
    { id: 'vault', label: 'Knowledge Vault', icon: Lock, isLocked: true },
  ];

  const settingsItems: SidebarItem[] = [
    { id: 'settings', label: 'Settings', icon: Settings, href: '/settings', color: 'text-gray-400' },
  ];

  const renderNavItem = (item: SidebarItem) => {
    const isActive = item.href ? pathname === item.href : false;
    const Icon = item.icon;

    const itemContent = (
      <div
        className={cn(
          'group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer',
          'hover:bg-[#21262d]',
          isActive && 'bg-[#21262d] shadow-sm',
          item.isLocked && 'opacity-40 cursor-not-allowed hover:bg-transparent',
          isCollapsed && 'justify-center px-2'
        )}
      >
        <div className={cn(
          'relative flex items-center justify-center w-8 h-8 rounded-lg transition-colors',
          isActive ? 'bg-teal-500/10' : 'bg-transparent group-hover:bg-[#30363d]'
        )}>
          <Icon className={cn(
            'h-[18px] w-[18px] transition-colors',
            isActive ? (item.color || 'text-teal-400') : 'text-gray-400 group-hover:text-gray-300',
            item.isLocked && 'text-gray-600'
          )} />
          {item.isLocked && !isCollapsed && (
            <Lock className="h-2 w-2 absolute -top-0.5 -right-0.5 text-gray-600" />
          )}
        </div>
        {!isCollapsed && (
          <>
            <span className={cn(
              'flex-1 text-[13px] font-medium transition-colors',
              isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-200',
              item.isLocked && 'text-gray-600'
            )}>
              {item.label}
            </span>
            {item.badge && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-400 font-medium uppercase">
                {item.badge}
              </span>
            )}
            {item.id === 'search' && (
              <kbd className="hidden lg:flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-[#30363d] text-gray-500 font-mono">
                <span className="text-[9px]">⌘</span>K
              </kbd>
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
              <TooltipContent side="right" className="bg-[#21262d] border-[#30363d]">
                <p className="text-gray-300">{item.label}</p>
                <p className="text-[10px] text-gray-500">Coming soon</p>
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
              <TooltipContent side="right" className="flex items-center gap-2 bg-[#21262d] border-[#30363d]">
                <p className="text-gray-300">{item.label}</p>
                {item.id === 'search' && (
                  <kbd className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-[#30363d] text-gray-500">
                    <span className="text-[9px]">⌘</span>K
                  </kbd>
                )}
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
              <TooltipContent side="right" className="bg-[#21262d] border-[#30363d]">
                <p className="text-gray-300">{item.label}</p>
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
          'fixed left-0 top-0 z-40 h-screen bg-[#0d1117] border-r border-[#30363d]',
          'flex flex-col transition-all duration-300 ease-out',
          isCollapsed ? 'w-[68px]' : 'w-[240px]'
        )}
      >
        {/* Logo */}
        <div className={cn(
          'flex items-center h-14 px-3 border-b border-[#30363d]',
          isCollapsed ? 'justify-center' : 'gap-3'
        )}>
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-teal-500/20">
            <span className="text-white font-bold text-sm">E</span>
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold text-white truncate">EmergentOS</span>
              <span className="text-[10px] text-gray-500">Phase 1 Alpha</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
          {/* Main Items */}
          <div className="space-y-0.5">
            {sidebarItems.map(renderNavItem)}
          </div>
          
          {/* Separator */}
          <div className="my-3 mx-2 border-t border-[#30363d]" />
          
          {/* Locked Items */}
          <div className="space-y-0.5">
            {!isCollapsed && (
              <p className="px-3 py-1 text-[9px] uppercase tracking-wider text-gray-600 font-medium">
                Coming Soon
              </p>
            )}
            {lockedItems.map(renderNavItem)}
          </div>
          
          {/* Separator */}
          <div className="my-3 mx-2 border-t border-[#30363d]" />
          
          {/* Settings */}
          <div className="space-y-0.5">
            {settingsItems.map(renderNavItem)}
          </div>
        </nav>

        {/* Source Indicators */}
        <SourceIndicators isCollapsed={isCollapsed} />

        {/* Collapse Toggle */}
        <div className="p-2 border-t border-[#30363d]">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className={cn(
              'w-full justify-center h-9 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-[#21262d]',
              !isCollapsed && 'justify-start px-3'
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
