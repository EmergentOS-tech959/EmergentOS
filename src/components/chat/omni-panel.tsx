'use client';

/**
 * EmergentOS - OmniPanel Chat
 * 
 * AI-powered chat with streaming responses from /api/ai/chat
 * Uses SSE (Server-Sent Events) for real-time streaming.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  Send,
  X,
  ChevronUp,
  Bot,
  User,
  Mail,
  Calendar,
  FileText,
  Plus,
  MessageSquare,
  Minimize2,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ChatMessage, ChatSource } from './types';
import { useSyncManager } from '@/lib/sync-manager';

interface OmniPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const QUICK_ACTIONS = [
  { icon: Mail, label: 'Summarize emails', query: 'Summarize my recent important emails', color: 'text-rose-400' },
  { icon: Calendar, label: 'Today\'s schedule', query: 'What\'s on my schedule today?', color: 'text-sky-400' },
  { icon: FileText, label: 'Recent docs', query: 'What documents have I recently worked on?', color: 'text-emerald-400' },
];

export function OmniPanel({ isOpen, onClose }: OmniPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const expandedInputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { providers } = useSyncManager();
  const hasConnections = Object.values(providers).some(p => p.status === 'connected');

  // ============================================================================
  // Auto-scroll to bottom
  // ============================================================================

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  // ============================================================================
  // Focus input when panel opens
  // ============================================================================

  useEffect(() => {
    if (isOpen && isExpanded && expandedInputRef.current) {
      expandedInputRef.current.focus();
    } else if (isOpen && !isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isExpanded]);

  // ============================================================================
  // Cleanup on unmount
  // ============================================================================

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // ============================================================================
  // Send Message with Streaming
  // ============================================================================

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    if (!hasConnections) {
      toast.warning('Please connect at least one data source', {
        description: 'Go to Settings to connect Gmail, Calendar, or Drive.',
      });
      return;
    }

    if (!isExpanded) setIsExpanded(true);

    const now = new Date();
    const userMsg: ChatMessage = { 
      id: `u-${now.getTime()}`, 
      role: 'user', 
      content: text, 
      createdAt: now 
    };

    const assistantMsgId = `a-${now.getTime() + 1}`;
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      createdAt: new Date(now.getTime() + 1),
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInputValue('');
    setIsStreaming(true);
    setError(null);

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Chat request failed');
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Process SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = '';
      let sources: ChatSource[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              // Stream complete
              break;
            }

            try {
              const parsed = JSON.parse(data);
              
              if (parsed.text) {
                accumulatedContent += parsed.text;
                
                // Update the assistant message with accumulated content
                setMessages(prev => prev.map(msg => 
                  msg.id === assistantMsgId 
                    ? { ...msg, content: accumulatedContent }
                    : msg
                ));
              }

              if (parsed.sources) {
                sources = parsed.sources;
              }
            } catch {
              // Skip invalid JSON lines (empty lines, etc.)
            }
          }
        }
      }

      // Finalize the message
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMsgId 
          ? { ...msg, content: accumulatedContent || 'I apologize, but I couldn\'t generate a response. Please try again.', isStreaming: false, sources }
          : msg
      ));

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request was aborted, don't show error
        return;
      }

      console.error('[OmniPanel] Chat error:', err);
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMsgId 
          ? { ...msg, content: `Error: ${errorMessage}`, isStreaming: false }
          : msg
      ));

      setError(errorMessage);
      toast.error('Chat failed', { description: errorMessage });
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [isStreaming, isExpanded, hasConnections]);

  // ============================================================================
  // Handlers
  // ============================================================================

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  const startNewChat = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setMessages([]);
    setError(null);
  };

  const handleQuickAction = (query: string) => {
    sendMessage(query);
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end w-[420px] max-w-[calc(100vw-32px)]">
      {/* Expanded Chat Area */}
      <div className={cn(
        'w-full bg-background border border-border rounded-xl shadow-lg overflow-hidden transition-all duration-200',
        isExpanded ? 'opacity-100' : 'opacity-0 h-0 pointer-events-none'
      )} style={{ maxHeight: isExpanded ? '520px' : '0px' }}>
        
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <h2 className="font-medium text-sm text-foreground">Assistant</h2>
              <p className="text-[10px] text-muted-foreground">
                {hasConnections ? 'AI-powered help' : 'Connect data sources to chat'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={startNewChat}
              disabled={isStreaming}
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3 mr-1" />
              New
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(false)}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="h-[340px] overflow-y-auto px-4 py-4 eos-scrollbar">
          {messages.length === 0 ? (
            <EmptyChat 
              hasConnections={hasConnections} 
              onQuickAction={handleQuickAction}
            />
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input Area in Expanded View */}
        <div className="px-4 py-3 border-t border-border bg-secondary/20">
          {error && (
            <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle className="h-3 w-3 text-red-400 shrink-0" />
              <span className="text-xs text-red-400">{error}</span>
            </div>
          )}
          <div className="flex items-end gap-2 bg-background border border-border rounded-lg px-3 py-2 focus-within:border-teal-500/50 transition-colors">
            <textarea
              ref={expandedInputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasConnections ? "Ask anything..." : "Connect data sources to chat"}
              disabled={!hasConnections || isStreaming}
              className="flex-1 bg-transparent text-foreground text-xs placeholder-muted-foreground focus:outline-none resize-none min-h-[20px] max-h-[80px] disabled:opacity-50"
              rows={1}
            />
            <Button
              size="sm"
              onClick={() => sendMessage(inputValue)}
              disabled={!inputValue.trim() || isStreaming || !hasConnections}
              className="h-7 w-7 p-0 rounded-md bg-teal-500 hover:bg-teal-600 disabled:opacity-40"
            >
              {isStreaming ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
              <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Collapsed Input Bar */}
      <div className={cn(
        'w-full flex items-center gap-2 bg-background border border-border rounded-lg shadow-lg p-2',
        isExpanded && 'mt-2'
      )}>
        {/* Avatar */}
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        
        {/* Input */}
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={hasConnections ? "Ask anything..." : "Connect data sources to chat"}
          disabled={!hasConnections || isStreaming}
          className="flex-1 min-w-0 bg-transparent text-foreground text-xs placeholder-muted-foreground focus:outline-none disabled:opacity-50"
        />
        
        {/* Send button */}
        <Button
          size="sm"
          onClick={() => sendMessage(inputValue)}
          disabled={!inputValue.trim() || isStreaming || !hasConnections}
          className="h-8 w-8 p-0 rounded-md bg-teal-500 hover:bg-teal-600 disabled:opacity-40 shrink-0"
        >
          {isStreaming ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
          <Send className="h-3.5 w-3.5" />
          )}
        </Button>
        
        {/* Expand button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="h-8 w-8 p-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary shrink-0"
        >
          <ChevronUp className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')} />
        </Button>
        
        {/* Close button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 w-8 p-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-2.5', isUser && 'flex-row-reverse')}>
      <div className={cn(
        'h-7 w-7 rounded-lg flex items-center justify-center shrink-0',
        isUser 
          ? 'bg-teal-500' 
          : 'bg-gradient-to-br from-amber-500 to-orange-500'
      )}>
        {isUser ? (
          <User className="h-3.5 w-3.5 text-white" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-white" />
        )}
      </div>
      <div className={cn(
        'max-w-[85%] rounded-lg px-3 py-2',
        isUser 
          ? 'bg-teal-500 text-white' 
          : 'bg-secondary/70 text-foreground'
      )}>
        <p className="text-xs leading-relaxed whitespace-pre-wrap">
          {message.content || (message.isStreaming ? '…' : '')}
          {message.isStreaming && (
            <span className="inline-block w-1.5 h-3 bg-current ml-0.5 animate-pulse" />
          )}
        </p>
        {message.sources && message.sources.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/30">
            <p className="text-[10px] text-muted-foreground/70 mb-1">Sources:</p>
            <div className="flex flex-wrap gap-1">
              {message.sources.map((source, idx) => (
                <span 
                  key={idx} 
                  className={cn(
                    'text-[9px] px-1.5 py-0.5 rounded',
                    source.kind === 'email' && 'bg-rose-500/15 text-rose-400',
                    source.kind === 'event' && 'bg-sky-500/15 text-sky-400',
                    source.kind === 'document' && 'bg-emerald-500/15 text-emerald-400',
                    source.kind === 'briefing' && 'bg-amber-500/15 text-amber-400'
                  )}
                >
                  {source.title}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyChat({ 
  hasConnections, 
  onQuickAction 
}: { 
  hasConnections: boolean;
  onQuickAction: (query: string) => void;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4">
      <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center mb-4">
        <Bot className="h-6 w-6 text-amber-500" />
      </div>
      
      <h3 className="text-sm font-medium text-foreground mb-1">How can I help?</h3>
      <p className="text-xs text-muted-foreground mb-5">
        {hasConnections 
          ? 'Ask about emails, calendar, or documents.'
          : 'Connect your data sources in Settings to start chatting.'}
      </p>
      
      {/* Quick Actions */}
      {hasConnections && (
        <div className="flex flex-col gap-2 w-full max-w-[280px]">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => onQuickAction(action.query)}
              className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-foreground bg-secondary/50 hover:bg-secondary border border-border/50 rounded-lg transition-colors text-left"
            >
              <action.icon className={cn('h-4 w-4 shrink-0', action.color)} />
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Minimized Button
// ============================================================================

export function OmniPanelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-4 right-4 z-50 w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 transition-all"
    >
      <MessageSquare className="h-5 w-5 text-white" />
    </button>
  );
}
