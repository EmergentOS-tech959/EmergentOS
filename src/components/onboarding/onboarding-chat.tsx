'use client';

/**
 * EmergentOS - Onboarding Chat
 * 
 * LinkedIn-style chat widget for onboarding conversation.
 * Messages stack from bottom like a real chat application.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Sparkles, User } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import type { OnboardingMessage } from '@/lib/onboarding/types';

interface OnboardingChatProps {
  messages: OnboardingMessage[];
  isTyping?: boolean;
  activeTypingMessageId?: string | null;
  onTypingComplete?: (messageId: string) => void;
  className?: string;
}

export function OnboardingChat({ messages, isTyping, activeTypingMessageId, onTypingComplete, className }: OnboardingChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom function - can be called by children during typing
  const scrollToBottom = useCallback(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, []);

  // Auto-scroll to bottom when new messages arrive or typing state changes
  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  return (
    <div 
      ref={scrollRef}
      className={cn(
        'flex-1 overflow-y-auto',
        'onboarding-scrollbar',
        'px-4 sm:px-6', // Add horizontal padding
        className
      )}
    >
      {/* Flex container that pushes content to bottom */}
      <div className="min-h-full flex flex-col justify-start py-6">
        <div className="space-y-6 max-w-2xl mx-auto w-full">
          {messages.map((message) => (
            <ChatMessage 
              key={message.id} 
              message={message} 
              isActivelyTyping={message.id === activeTypingMessageId}
              onTypingComplete={onTypingComplete}
              onContentGrow={scrollToBottom}
            />
          ))}
          
          {/* Typing indicator */}
          {isTyping && (
            <div className="flex items-start gap-4 animate-fade-in pl-1">
              <MessageAvatar isAssistant />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                   <span className="text-xs font-medium text-muted-foreground">EmergentOS</span>
                </div>
                <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-secondary/40 inline-flex items-center gap-1.5 border border-border/40 shadow-sm">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            </div>
          )}
          
          {/* Scroll anchor */}
          <div ref={bottomRef} className="h-1" />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Message Component
// ============================================================================

function ChatMessage({ 
  message, 
  isActivelyTyping,
  onTypingComplete,
  onContentGrow
}: { 
  message: OnboardingMessage;
  isActivelyTyping?: boolean;
  onTypingComplete?: (messageId: string) => void;
  onContentGrow?: () => void;
}) {
  const isAssistant = message.role === 'assistant';
  
  // Only start typing if this message is the actively typing one
  const shouldType = message.isTyping && isActivelyTyping && isAssistant;
  
  // Typing effect state
  const [displayedContent, setDisplayedContent] = useState(
    shouldType ? '' : message.content
  );
  const [isTypingEffect, setIsTypingEffect] = useState(shouldType);
  const hasCompletedRef = useRef(false);
  const lastScrollRef = useRef(0);

  useEffect(() => {
    // If not supposed to type, show full content immediately
    if (!shouldType) {
      setDisplayedContent(message.content);
      setIsTypingEffect(false);
      return;
    }

    // Reset for new typing session
    hasCompletedRef.current = false;
    lastScrollRef.current = 0;
    setDisplayedContent('');
    setIsTypingEffect(true);

    let currentIndex = 0;
    const content = message.content;
    const interval = setInterval(() => {
      if (currentIndex <= content.length) {
        setDisplayedContent(content.slice(0, currentIndex));
        
        // Scroll periodically during typing (every ~20 characters or on newlines)
        if (onContentGrow && (currentIndex - lastScrollRef.current > 20 || content[currentIndex - 1] === '\n')) {
          lastScrollRef.current = currentIndex;
          onContentGrow();
        }
        
        currentIndex++;
      } else {
        setIsTypingEffect(false);
        clearInterval(interval);
        // Final scroll after typing completes
        if (onContentGrow) {
          onContentGrow();
        }
        // Signal completion to parent
        if (!hasCompletedRef.current && onTypingComplete) {
          hasCompletedRef.current = true;
          onTypingComplete(message.id);
        }
      }
    }, 15); // Typing speed

    return () => clearInterval(interval);
  }, [shouldType, message.content, message.id, onTypingComplete, onContentGrow]);

  return (
    <div className={cn(
      'flex items-start gap-4', // Increased gap
      'group', // For hover effects
      'animate-message-in',
      !isAssistant && 'flex-row-reverse'
    )}>
      <MessageAvatar isAssistant={isAssistant} />
      
      <div className={cn(
        'flex-1 min-w-0 max-w-[85%]',
        !isAssistant && 'flex flex-col items-end'
      )}>
        <MessageHeader isAssistant={isAssistant} timestamp={message.timestamp} />
        
        <div className={cn(
          'mt-1.5 px-5 py-3.5 rounded-2xl',
          'text-sm leading-7', // Relaxed reading
          'shadow-sm backdrop-blur-md',
          'transition-all duration-200',
          isAssistant
            ? 'bg-secondary/40 text-foreground/90 border border-border/50 rounded-tl-sm hover:bg-secondary/50'
            : 'bg-gradient-to-br from-teal-500/90 to-teal-600/90 text-white rounded-tr-sm border border-teal-400/20 shadow-teal-500/10'
        )}>
          <p className="whitespace-pre-wrap">
            {displayedContent}
            {isTypingEffect && (
              <span className="inline-block w-1.5 h-4 align-middle ml-0.5 bg-teal-500/50 animate-pulse" />
          )}
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Avatar Component
// ============================================================================

function MessageAvatar({ isAssistant }: { isAssistant: boolean }) {
  if (!isAssistant) {
     return null; // Don't show user avatar to keep it clean, typical for modern chat UI
  }

  return (
    <div className={cn(
      'shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-1', // Changed to rounded-full
      'shadow-sm transition-transform hover:scale-105',
      'bg-gradient-to-br from-teal-500/10 to-teal-600/10 border border-teal-500/20'
    )}>
       <div className="w-5 h-5 relative">
          <Image
            src="/logo.png"
            alt="EmergentOS"
            width={20}
            height={20}
            className="object-contain brightness-0 invert opacity-80"
          />
        </div>
    </div>
  );
}

// ============================================================================
// Header Component
// ============================================================================

function MessageHeader({ 
  isAssistant, 
  timestamp 
}: { 
  isAssistant: boolean; 
  timestamp?: string;
}) {
  if (!isAssistant) return null; // Hide header for user to reduce noise

  return (
    <div className="flex items-center gap-2 mb-1 ml-1">
      <span className="text-xs font-medium text-foreground/70">
        EmergentOS
      </span>
    </div>
  );
}
