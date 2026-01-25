'use client';

/**
 * EmergentOS - Onboarding Input
 * 
 * LinkedIn-style expandable input field with send button.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OnboardingInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

const MIN_HEIGHT = 150;
const MAX_HEIGHT = 200;

export function OnboardingInput({
  onSend,
  disabled = false,
  placeholder = 'Write a message...',
  className,
}: OnboardingInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const newHeight = Math.min(Math.max(textarea.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    textarea.style.height = `${newHeight}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [disabled]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = `${MIN_HEIGHT}px`;
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className={cn(
      'relative flex items-end gap-2',
      // Removed generic p-3 and border-t for cleaner look
      className
    )}>
      <div className={cn(
        'flex-1 flex items-end',
        'bg-transparent hover:bg-white/[0.02]', // Nearly invisible background
        'border border-white/10 rounded-2xl', // Subtle visible border only
        'transition-all duration-200',
        'focus-within:border-teal-500/40 focus-within:bg-white/[0.02] focus-within:shadow-[0_0_30px_rgba(20,184,166,0.08)]',
        disabled && 'opacity-50 cursor-not-allowed'
      )}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className={cn(
            'flex-1 bg-transparent resize-none',
            'px-5 py-4', // More padding
            'text-sm text-foreground placeholder:text-muted-foreground/70',
            'focus:outline-none',
            'disabled:cursor-not-allowed',
            'onboarding-scrollbar'
          )}
          style={{
            minHeight: `${MIN_HEIGHT}px`,
            maxHeight: `${MAX_HEIGHT}px`,
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={!canSend}
          className={cn(
            'shrink-0 flex items-center justify-center',
            'w-8 h-8 m-2 rounded-xl', // Smaller, more padding around it
            'transition-all duration-200',
            canSend
              ? 'bg-teal-500 hover:bg-teal-600 text-white shadow-md hover:shadow-lg hover:scale-105'
              : 'bg-transparent text-muted-foreground/30 cursor-not-allowed'
          )}
          aria-label="Send message"
        >
          <Send className={cn("h-4 w-4", canSend && "ml-0.5")} /> 
        </button>
      </div>
    </div>
  );
}

