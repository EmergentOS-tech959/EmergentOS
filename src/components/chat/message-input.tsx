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
    <div className="p-4 border-t border-border">
      <div className="flex items-end gap-2">
        <Textarea
          placeholder={placeholder || 'Type a message…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          className="min-h-[44px] max-h-40 resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button
          size="icon"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="bg-primary hover:bg-primary/90"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-2 text-center">
        Messages are scanned with DLP before any storage or AI processing.
      </p>
    </div>
  );
}

