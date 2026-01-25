'use client';

/**
 * EmergentOS - Onboarding Logo
 * 
 * Animated logo with glowing orb effect for the onboarding screen.
 */

import Image from 'next/image';
import { cn } from '@/lib/utils';

interface OnboardingLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function OnboardingLogo({ className, size = 'md' }: OnboardingLogoProps) {
  const sizeClasses = {
    sm: {
      container: 'w-16 h-16',
      glow: 'w-24 h-24',
      ring1: 'w-20 h-20',
      ring2: 'w-18 h-18',
      logo: 'w-12 h-12',
      title: 'text-lg',
      subtitle: 'text-[10px]',
    },
    md: {
      container: 'w-20 h-20',
      glow: 'w-32 h-32',
      ring1: 'w-28 h-28',
      ring2: 'w-24 h-24',
      logo: 'w-14 h-14',
      title: 'text-xl',
      subtitle: 'text-xs',
    },
    lg: {
      container: 'w-24 h-24',
      glow: 'w-40 h-40',
      ring1: 'w-32 h-32',
      ring2: 'w-28 h-28',
      logo: 'w-16 h-16',
      title: 'text-2xl',
      subtitle: 'text-sm',
    },
  };

  const s = sizeClasses[size];

  return (
    <div className={cn('flex flex-col items-center', className)}>
      {/* Logo Graphic Wrapper */}
      <div className="relative flex items-center justify-center">
      {/* Outer glow effect */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className={cn(
          s.glow,
          'rounded-full',
            'bg-gradient-to-br from-teal-500/20 via-sky-500/10 to-teal-400/20',
          'blur-2xl animate-pulse-slow'
        )} />
      </div>
      
      {/* Animated ring 1 */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className={cn(
          s.ring1,
            'rounded-full border border-teal-500/30 animate-ring-spin-slow'
        )} />
      </div>
      
      {/* Animated ring 2 (counter-rotate) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className={cn(
          s.ring2,
            'rounded-full border border-sky-400/20 animate-ring-spin-reverse-slow'
        )} />
      </div>
      
      {/* Logo container */}
        <div className={cn(
          s.container,
          'relative flex items-center justify-center z-10'
        )}>
          {/* Inner glow - Adjusted to just be a soft backlight */}
          <div className="absolute inset-0 bg-teal-500/30 blur-xl animate-pulse-slow pointer-events-none rounded-full" />
          
          {/* Logo image */}
          <div className="relative z-10">
            <Image
              src="/logo.png"
              alt="EmergentOS"
              width={64}
              height={64}
              className={cn(s.logo, 'object-contain drop-shadow-[0_0_15px_rgba(20,184,166,0.6)] brightness-0 invert')}
              priority
            />
          </div>
        </div>
      </div>
      
      {/* Brand name */}
      <div className="mt-6 text-center relative z-10">
        <h1 className={cn(s.title, 'font-semibold text-foreground tracking-tight')}>
          EmergentOS
        </h1>
        <p className={cn(s.subtitle, 'text-muted-foreground/70 mt-0.5')}>
          Your Personal Operating System
        </p>
      </div>
    </div>
  );
}
