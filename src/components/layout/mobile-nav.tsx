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
  accentColor: string;
  activeGradient: string;
}

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenCommandPalette?: () => void;
}

export function MobileNav({ isOpen, onClose, onOpenCommandPalette }: MobileNavProps) {
  const pathname = usePathname();

  const handleLockedClick = (label: string) => {
    toast.info(`${label} — Coming in Phase 2`, {
      description: 'This feature is not available yet.',
      duration: 2500,
    });
  };

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard', accentColor: 'text-teal-400', activeGradient: 'from-teal-500/15 to-teal-500/5' },
    { id: 'search', label: 'Search', icon: Search, action: onOpenCommandPalette, accentColor: 'text-sky-400', activeGradient: 'from-sky-500/15 to-sky-500/5' },
    { id: 'inbox', label: 'Unified Inbox', icon: Inbox, href: '/inbox', badge: 'new', accentColor: 'text-violet-400', activeGradient: 'from-violet-500/15 to-violet-500/5' },
    { id: 'resources', label: 'Resources', icon: FolderOpen, href: '/resources', accentColor: 'text-amber-400', activeGradient: 'from-amber-500/15 to-amber-500/5' },
  ];

  const lockedItems: NavItem[] = [
    { id: 'pulse', label: 'Pulse', icon: Activity, isLocked: true, accentColor: 'text-muted-foreground/50', activeGradient: '' },
    { id: 'intelligence', label: 'Intelligence', icon: Brain, isLocked: true, accentColor: 'text-muted-foreground/50', activeGradient: '' },
    { id: 'decisions', label: 'Decisions', icon: GitBranch, isLocked: true, accentColor: 'text-muted-foreground/50', activeGradient: '' },
    { id: 'workflows', label: 'Workflows', icon: Workflow, isLocked: true, accentColor: 'text-muted-foreground/50', activeGradient: '' },
    { id: 'vault', label: 'Knowledge Vault', icon: Lock, isLocked: true, accentColor: 'text-muted-foreground/50', activeGradient: '' },
  ];

  const settingsItem: NavItem = { 
    id: 'settings', 
    label: 'Settings', 
    icon: Settings, 
    href: '/settings', 
    accentColor: 'text-slate-400',
    activeGradient: 'from-slate-500/15 to-slate-500/5'
  };

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
          'group relative flex items-center gap-3.5 px-4 py-3 rounded-lg cursor-pointer',
          'transition-all duration-200 ease-out active:scale-[0.98]',
          // Active state
          isActive && !item.isLocked && `bg-gradient-to-r ${item.activeGradient}`,
          // Hover state  
          !isActive && !item.isLocked && 'active:bg-white/[0.06]',
          // Locked state
          item.isLocked && 'opacity-50 cursor-not-allowed'
        )}
        onClick={!item.href ? handleClick : undefined}
      >
        {/* Active indicator bar */}
        {isActive && !item.isLocked && (
          <div className={cn(
            'absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-r-full',
            item.accentColor.replace('text-', 'bg-')
          )} />
        )}
        
        {/* Icon container */}
        <div className={cn(
          'relative w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200',
          isActive && !item.isLocked && 'bg-white/[0.06]',
          !isActive && !item.isLocked && 'bg-white/[0.02]'
        )}>
          <Icon className={cn(
            'h-5 w-5 transition-colors duration-200',
            isActive && !item.isLocked && item.accentColor,
            !isActive && !item.isLocked && 'text-muted-foreground',
            item.isLocked && 'text-muted-foreground/50'
          )} />
          
          {/* Lock indicator */}
          {item.isLocked && (
            <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-background border border-border/50 flex items-center justify-center">
              <Lock className="h-2 w-2 text-muted-foreground/60" />
            </div>
          )}
        </div>
        
        {/* Label */}
        <span className={cn(
          'flex-1 text-[15px] font-medium transition-colors duration-200',
          isActive && !item.isLocked && 'text-foreground',
          !isActive && !item.isLocked && 'text-muted-foreground',
          item.isLocked && 'text-muted-foreground/50'
        )}>
          {item.label}
        </span>
        
        {/* Badge */}
        {item.badge && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-teal-500/15 text-teal-400 border border-teal-500/20">
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
      <SheetContent 
        side="left" 
        className="w-[300px] p-0 bg-gradient-to-b from-[#0d1117] via-[#0c0f14] to-[#0a0c10] border-r border-white/[0.06]"
      >
        {/* Subtle top highlight */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
        
        <SheetHeader className="relative p-5 border-b border-white/[0.06]">
          <SheetTitle className="flex items-center gap-3">
            {/* Logo with glow */}
            <div className="relative group">
              <div className={cn(
                'absolute -inset-0.5 rounded-xl blur-md',
                'bg-gradient-to-br from-teal-400/40 to-teal-600/40',
                'opacity-60'
              )} />
              <div className={cn(
                'relative h-10 w-10 rounded-xl',
                'bg-gradient-to-br from-teal-400 to-teal-600',
                'flex items-center justify-center',
                'shadow-lg shadow-teal-500/20'
              )}>
                <Sparkles className="h-5 w-5 text-white" />
              </div>
            </div>
            
            <div className="flex flex-col">
              <span className="text-[15px] font-semibold text-foreground tracking-tight">
                EmergentOS
              </span>
              <span className="text-[10px] text-teal-400/80 font-medium tracking-wide">
                Phase 1 Alpha
              </span>
            </div>
          </SheetTitle>
        </SheetHeader>

        <nav className="p-3 overflow-y-auto eos-scrollbar-thin">
          {/* Main navigation */}
          <div className="space-y-0.5">
            {navItems.map(renderNavItem)}
          </div>
          
          {/* Separator */}
          <div className="my-4 mx-3">
            <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
          </div>
          
          {/* Locked items section */}
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 px-4 py-2">
              <Lock className="h-3 w-3 text-muted-foreground/40" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-semibold">
                Coming Soon
              </span>
            </div>
            {lockedItems.map(renderNavItem)}
          </div>
          
          {/* Separator */}
          <div className="my-4 mx-3">
            <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
          </div>
          
          {/* Settings */}
          <div className="space-y-0.5">
            {renderNavItem(settingsItem)}
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
