'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send } from 'lucide-react';

export function MessageInput({
  onSend,
  disabled,
  placeholder,
  initialValue,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
  placeholder?: string;
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue || '');

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  };

  return (
    <div className="p-3 border-t border-border bg-secondary/20">
      <div className="flex items-end gap-2">
        <Textarea
          placeholder={placeholder || 'Type a message…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          className="min-h-[36px] max-h-24 resize-none text-xs bg-background"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button
          size="sm"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="h-9 w-9 p-0 bg-teal-500 hover:bg-teal-600"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="text-[9px] text-muted-foreground/60 mt-2 text-center">
        Messages are scanned with DLP before processing.
      </p>
    </div>
  );
}

