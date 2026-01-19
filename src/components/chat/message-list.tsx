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
        <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-8">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h4 className="font-medium">How can I help you today?</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Ask questions about your emails, calendar, documents, or briefings.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn('flex gap-3', message.role === 'user' && 'flex-row-reverse')}
            >
              <div
                className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0',
                  message.role === 'user' ? 'bg-human-blue/10' : 'bg-ai-copper/10'
                )}
              >
                {message.role === 'user' ? (
                  <User className="h-4 w-4 text-human-blue" />
                ) : (
                  <Bot className="h-4 w-4 text-ai-copper" />
                )}
              </div>

              <div
                className={cn(
                  'max-w-[80%] rounded-lg px-3 py-2',
                  message.role === 'user' ? 'bg-human-blue text-white' : 'bg-secondary'
                )}
              >
                <div className={cn('text-sm whitespace-pre-wrap', message.isStreaming && 'animate-pulse')}>
                  {message.content || (message.isStreaming ? '…' : '')}
                </div>
                {message.role === 'assistant' && <SourceCitations sources={message.sources} />}
                <span className="text-[10px] opacity-70 mt-1 block">
                  {message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}

          {isThinking && (
            <div className="flex gap-3">
              <div className="h-8 w-8 rounded-full bg-ai-copper/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-ai-copper" />
              </div>
              <div className="bg-secondary rounded-lg px-4 py-3">
                <span className="text-sm text-muted-foreground">Securing & thinking…</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      )}
    </ScrollArea>
  );
}

