'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  Send,
  X,
  ChevronUp,
  Loader2,
  Bot,
  User,
  Mail,
  Calendar,
  FileText,
  Plus,
  MessageSquare,
  Minimize2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ChatMessage, ChatSource } from './types';

type ApiHistoryRow = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: unknown[] | null;
  created_at: string;
};

function isUiRole(role: ApiHistoryRow['role']): role is 'user' | 'assistant' {
  return role === 'user' || role === 'assistant';
}

interface OmniPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const QUICK_ACTIONS = [
  { icon: Mail, label: 'Summarize emails', query: 'Summarize my recent important emails', color: 'text-rose-400', bg: 'bg-rose-500/10' },
  { icon: Calendar, label: 'Today\'s schedule', query: 'What\'s on my schedule today?', color: 'text-sky-400', bg: 'bg-sky-500/10' },
  { icon: FileText, label: 'Recent documents', query: 'What documents have I recently worked on?', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
];

export function OmniPanel({ isOpen, onClose }: OmniPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const expandedInputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    if (isOpen && isExpanded && expandedInputRef.current) {
      expandedInputRef.current.focus();
    } else if (isOpen && !isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isExpanded]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = 'eos_chat_session_id';
    const existing = window.localStorage.getItem(key);
    const next = existing && existing.length > 0 ? existing : window.crypto.randomUUID();
    if (!existing) window.localStorage.setItem(key, next);
    setSessionId(next);
  }, []);

  const loadHistory = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/ai/chat?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET', cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as { messages?: ApiHistoryRow[] };
      const rows = Array.isArray(json.messages) ? json.messages : [];
      const mapped: ChatMessage[] = rows
        .filter((r): r is ApiHistoryRow & { role: 'user' | 'assistant' } => isUiRole(r.role))
        .map((r) => ({
          id: r.id,
          role: r.role,
          content: r.content,
          createdAt: new Date(r.created_at),
          sources: (Array.isArray(r.sources) ? (r.sources as ChatSource[]) : undefined) || undefined,
        }));
      setMessages(mapped);
    } catch { /* best-effort */ }
  }, [sessionId]);

  useEffect(() => {
    if (isOpen && isExpanded) void loadHistory();
  }, [isOpen, isExpanded, loadHistory]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!sessionId || !text.trim()) return;
      if (isThinking) return;

      if (!isExpanded) setIsExpanded(true);

      const now = new Date();
      const userMsg: ChatMessage = { id: `u-${now.getTime()}`, role: 'user', content: text, createdAt: now };
      const assistantMsgId = `a-${now.getTime() + 1}`;
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        createdAt: new Date(now.getTime() + 1),
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsThinking(true);
      setInputValue('');

      let res: Response;
      try {
        res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, message: text }),
        });
      } catch (err) {
        toast.error(`Chat failed: ${err instanceof Error ? err.message : 'Network error'}`);
        setIsThinking(false);
        setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, isStreaming: false, content: 'Connection failed.' } : m)));
        return;
      }

      if (!res.ok || !res.body) {
        const errJson = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(`Chat failed: ${errJson?.error || `HTTP ${res.status}`}`);
        setIsThinking(false);
        setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, isStreaming: false, content: errJson?.error || 'Error' } : m)));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          while (true) {
            const sep = buffer.indexOf('\n\n');
            if (sep === -1) break;
            const raw = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);

            const lines = raw.split('\n');
            let event = '', data = '';
            for (const line of lines) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              if (line.startsWith('data:')) data += line.slice(5).trim();
            }

            if (event === 'token') {
              const parsed = JSON.parse(data) as { delta?: string };
              if (parsed.delta) {
                setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, content: (m.content || '') + parsed.delta } : m)));
              }
            } else if (event === 'done') {
              const parsed = JSON.parse(data) as { sources?: ChatSource[] };
              setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, isStreaming: false, sources: parsed.sources || m.sources } : m)));
            }
          }
        }
      } catch (err) {
        toast.error(`Stream failed: ${err instanceof Error ? err.message : 'Error'}`);
      } finally {
        setIsThinking(false);
        setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, isStreaming: false } : m)));
      }
    },
    [sessionId, isThinking, isExpanded]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(inputValue);
    }
  };

  const startNewChat = () => {
    setMessages([]);
    const newId = window.crypto.randomUUID();
    window.localStorage.setItem('eos_chat_session_id', newId);
    setSessionId(newId);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end w-[680px] max-w-[calc(100vw-40px)]">
      {/* Expanded Chat Area */}
      <div className={cn(
        'w-full bg-[#0d1117] border border-[#21262d] rounded-2xl shadow-2xl overflow-hidden transition-all duration-200',
        isExpanded ? 'opacity-100' : 'opacity-0 h-0 pointer-events-none'
      )} style={{ maxHeight: isExpanded ? 'calc(80vh - 70px)' : '0px' }}>
        
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#21262d] bg-[#161b22]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <h2 className="font-medium text-white text-sm">EmergentOS Assistant</h2>
              <p className="text-[11px] text-gray-500">AI-powered assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={startNewChat}
              className="h-8 px-3 text-xs text-gray-400 hover:text-white hover:bg-[#21262d] rounded-lg"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(false)}
              className="h-8 w-8 p-0 text-gray-400 hover:text-white hover:bg-[#21262d] rounded-lg"
            >
              <Minimize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="h-[420px] overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center mb-4 border border-amber-500/20">
                <Bot className="h-7 w-7 text-amber-500" />
              </div>
              
              <h3 className="text-lg font-semibold text-white mb-1">How can I help you?</h3>
              <p className="text-xs text-gray-500 mb-6">
                Ask about your emails, calendar, or documents.
              </p>
              
              {/* Quick Actions */}
              <div className="flex flex-wrap gap-2 justify-center">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => void sendMessage(action.query)}
                    className="flex items-center gap-2 px-3 py-2 text-xs text-gray-300 bg-[#161b22] hover:bg-[#21262d] border border-[#30363d] rounded-lg transition-colors"
                  >
                    <action.icon className={cn('h-3.5 w-3.5', action.color)} />
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => (
                <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' && 'flex-row-reverse')}>
                  <div className={cn(
                    'h-7 w-7 rounded-lg flex items-center justify-center shrink-0',
                    msg.role === 'user' 
                      ? 'bg-teal-600' 
                      : 'bg-gradient-to-br from-amber-500 to-orange-600'
                  )}>
                    {msg.role === 'user' ? <User className="h-3.5 w-3.5 text-white" /> : <Bot className="h-3.5 w-3.5 text-white" />}
                  </div>
                  <div className={cn(
                    'max-w-[85%] rounded-xl px-3.5 py-2.5',
                    msg.role === 'user' 
                      ? 'bg-teal-600 text-white' 
                      : 'bg-[#161b22] border border-[#30363d] text-gray-200'
                  )}>
                    <p className={cn('text-[13px] leading-relaxed whitespace-pre-wrap', msg.isStreaming && 'animate-pulse')}>
                      {msg.content || '…'}
                    </p>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[#30363d] flex flex-wrap gap-1">
                        {msg.sources.map((s, i) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-[#21262d] text-gray-400">
                            {s.title || s.kind}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isThinking && messages[messages.length - 1]?.role !== 'assistant' && (
                <div className="flex gap-3">
                  <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                    <Bot className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="bg-[#161b22] border border-[#30363d] rounded-xl px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-xs text-gray-500">Thinking</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input Area in Expanded View */}
        <div className="px-4 py-3 border-t border-[#21262d] bg-[#161b22]">
          <div className="flex items-end gap-3 bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2.5 focus-within:border-amber-500/50 transition-colors">
            <textarea
              ref={expandedInputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none resize-none min-h-[24px] max-h-[100px]"
              rows={1}
              disabled={isThinking}
            />
            <Button
              size="sm"
              onClick={() => void sendMessage(inputValue)}
              disabled={isThinking || !inputValue.trim()}
              className="h-9 w-9 p-0 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 disabled:opacity-40"
            >
              {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Collapsed Input Bar - Same width as expanded */}
      <div className={cn(
        'w-full flex items-center gap-2.5 bg-[#0d1117] border border-[#21262d] rounded-xl shadow-xl p-2.5',
        isExpanded && 'mt-3'
      )}>
        {/* Avatar */}
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        
        {/* Input */}
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask EmergentOS..."
          className="flex-1 min-w-0 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none"
          disabled={isThinking}
        />
        
        {/* Send button */}
        <Button
          size="sm"
          onClick={() => void sendMessage(inputValue)}
          disabled={isThinking || !inputValue.trim()}
          className="h-9 w-9 p-0 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 disabled:opacity-40 shrink-0"
        >
          {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
        
        {/* Expand button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="h-9 w-9 p-0 rounded-lg text-gray-400 hover:text-white hover:bg-[#21262d] shrink-0"
        >
          <ChevronUp className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')} />
        </Button>
        
        {/* Close button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-9 w-9 p-0 rounded-lg text-gray-400 hover:text-white hover:bg-[#21262d] shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Minimized Avatar Button
export function OmniPanelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20 hover:shadow-orange-500/40 hover:scale-105 transition-all"
    >
      <MessageSquare className="h-5 w-5 text-white" />
    </button>
  );
}
