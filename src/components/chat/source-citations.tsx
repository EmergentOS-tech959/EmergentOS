'use client';

import { Badge } from '@/components/ui/badge';
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
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.slice(0, 6).map((s) => (
        <Badge key={`${s.kind}:${s.id}`} variant="secondary" className="text-[10px]">
          {labelForKind(s.kind)} • {s.title}
        </Badge>
      ))}
    </div>
  );
}

