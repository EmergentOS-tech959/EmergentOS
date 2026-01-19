export type ChatRole = 'user' | 'assistant';

export type ChatSource = {
  kind: 'email' | 'event' | 'document' | 'briefing';
  id: string;
  title: string;
  occurredAt?: string;
  snippet?: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: Date;
  sources?: ChatSource[];
  isStreaming?: boolean;
};

