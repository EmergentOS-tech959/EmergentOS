'use client';

import type { ChatSource } from './types';

function labelForKind(kind: ChatSource['kind']): string {
  if (kind === 'email') return 'Email';
  if (kind === 'event') return 'Calendar';
  if (kind === 'document') return 'Drive';
  return 'Briefing';
}

export function SourceCitations({ sources }: { sources?: ChatSource[] }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-border/30 flex flex-wrap gap-1">
      {sources.slice(0, 4).map((s) => (
        <span key={`${s.kind}:${s.id}`} className="text-[9px] px-1.5 py-0.5 rounded bg-background/50 text-muted-foreground">
          {labelForKind(s.kind)} · {s.title}
        </span>
      ))}
    </div>
  );
}

