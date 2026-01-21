'use client';

import type { RefObject } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Bot, User } from 'lucide-react';
import type { ChatMessage } from './types';
import { SourceCitations } from './source-citations';

export function MessageList({
  messages,
  bottomRef,
  isThinking,
}: {
  messages: ChatMessage[];
  bottomRef: RefObject<HTMLDivElement | null>;
  isThinking: boolean;
}) {
  return (
    <ScrollArea className="flex-1 p-4">
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-8">
          <div className="h-12 w-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <Bot className="h-6 w-6 text-amber-500" />
          </div>
          <div>
            <h4 className="font-medium text-sm text-foreground">How can I help?</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Ask about emails, calendar, or documents.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn('flex gap-2.5', message.role === 'user' && 'flex-row-reverse')}
            >
              <div
                className={cn(
                  'h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0',
                  message.role === 'user' ? 'bg-teal-500' : 'bg-gradient-to-br from-amber-500 to-orange-500'
                )}
              >
                {message.role === 'user' ? (
                  <User className="h-3.5 w-3.5 text-white" />
                ) : (
                  <Bot className="h-3.5 w-3.5 text-white" />
                )}
              </div>

              <div
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2',
                  message.role === 'user' ? 'bg-teal-500 text-white' : 'bg-secondary/70'
                )}
              >
                <div className={cn('text-xs leading-relaxed whitespace-pre-wrap', message.isStreaming && 'animate-pulse')}>
                  {message.content || (message.isStreaming ? '…' : '')}
                </div>
                {message.role === 'assistant' && <SourceCitations sources={message.sources} />}
                <span className="text-[9px] opacity-60 mt-1 block">
                  {message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}

          {isThinking && (
            <div className="flex gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                <Bot className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="bg-secondary/70 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground">Thinking</span>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      )}
    </ScrollArea>
  );
}

