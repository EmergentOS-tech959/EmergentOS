'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
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
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  action?: () => void;
  badge?: string | number;
  isLocked?: boolean;
}

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenCommandPalette?: () => void;
}

export function MobileNav({ isOpen, onClose, onOpenCommandPalette }: MobileNavProps) {
  const pathname = usePathname();

  const handleLockedClick = (label: string) => {
    toast.info(`${label} is locked in Alpha Phase`, {
      description: 'This feature will be available in Phase 2.',
      duration: 3000,
    });
  };

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
    { id: 'search', label: 'Search', icon: Search, action: onOpenCommandPalette },
    { id: 'inbox', label: 'Unified Inbox', icon: Inbox, href: '/inbox', badge: 'new' },
    { id: 'resources', label: 'Resources', icon: FolderOpen, href: '/resources' },
  ];

  const lockedItems: NavItem[] = [
    { id: 'pulse', label: 'Pulse', icon: Activity, isLocked: true },
    { id: 'intelligence', label: 'Intelligence', icon: Brain, isLocked: true },
    { id: 'decisions', label: 'Decisions', icon: GitBranch, isLocked: true },
    { id: 'workflows', label: 'Workflows', icon: Workflow, isLocked: true },
    { id: 'vault', label: 'Knowledge Vault', icon: Lock, isLocked: true },
  ];

  const settingsItems: NavItem[] = [
    { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
  ];

  const renderNavItem = (item: NavItem) => {
    const isActive = item.href ? pathname === item.href : false;
    const Icon = item.icon;

    const handleClick = () => {
      if (item.isLocked) {
        handleLockedClick(item.label);
        return;
      }
      if (item.action) {
        item.action();
      }
      onClose();
    };

    const content = (
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
          'hover:bg-secondary',
          isActive && 'bg-secondary text-primary',
          item.isLocked && 'opacity-50'
        )}
        onClick={!item.href ? handleClick : undefined}
      >
        <div className="relative">
          <Icon className={cn('h-5 w-5', isActive && 'text-primary')} />
          {item.isLocked && (
            <Lock className="h-2.5 w-2.5 absolute -top-1 -right-1 text-muted-foreground" />
          )}
        </div>
        <span className={cn('flex-1', isActive && 'font-medium')}>
          {item.label}
        </span>
        {item.badge && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
            {item.badge}
          </span>
        )}
      </div>
    );

    if (item.href && !item.isLocked) {
      return (
        <Link key={item.id} href={item.href} onClick={onClose}>
          {content}
        </Link>
      );
    }

    return <div key={item.id}>{content}</div>;
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="p-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold">E</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">EmergentOS</span>
              <span className="text-[10px] text-muted-foreground font-normal">Phase 1 Alpha</span>
            </div>
          </SheetTitle>
        </SheetHeader>

        <nav className="p-2 space-y-1">
          {navItems.map(renderNavItem)}
          
          <Separator className="my-3" />
          
          <div className="px-4 py-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              Coming Soon
            </span>
          </div>
          {lockedItems.map(renderNavItem)}
          
          <Separator className="my-3" />
          
          {settingsItems.map(renderNavItem)}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
