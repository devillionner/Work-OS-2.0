import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Одне речення про те, що тут з'явиться, і одна дія. Без ілюстрацій. */
export function EmptyState({ text, action, className }: { text: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-start gap-3 rounded-inner border border-dashed border-line-strong px-5 py-6', className)}>
      <p className="m-0 max-w-[46ch] text-sm text-ink-2">{text}</p>
      {action}
    </div>
  );
}
