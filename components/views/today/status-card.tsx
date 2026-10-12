'use client';

import { Surface } from '@/components/ui/surface';
import type { Status, StatusTone } from '@/components/views/today/use-day';
import { cn } from '@/lib/utils';

const DOT: Record<StatusTone, string> = { ok: 'bg-ok', hot: 'bg-hot', neutral: 'bg-line-strong' };

/**
 * Статуси дня списком: звіт за вчора, звіт за сьогодні, розклад Telegram, кожен — крапка, підпис і слово без обрізання.
 * Червоним буває лише вчорашній незданий звіт.
 */
export function StatusCard({ statuses, size }: { statuses: readonly Status[]; size: 'phone' | 'desktop' }) {
  return (
    <Surface variant="glass" radius="card" data-reveal className={cn('min-w-0', size === 'phone' ? 'p-3.5' : 'p-5')} aria-label="Статуси дня">
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {statuses.map((status) => (
          <li key={status.key}>
            <button type="button" title={status.title} onClick={status.open} className="flex min-h-9 w-full items-center justify-start gap-2.5 rounded-xl border border-transparent px-2.5 py-1.5 text-left text-[13.5px] transition-colors duration-150 hover:border-line-strong hover:bg-raised [@media(pointer:coarse)]:min-h-11">
              <i aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', status.loading ? 'animate-pulse bg-line-strong' : DOT[status.tone])} />
              <span className="text-ink-2">{status.label}</span>
              <span className={cn('font-medium', status.loading ? 'text-ink-3' : status.tone === 'hot' ? 'text-hot' : 'text-ink', status.link && !status.loading && 'underline underline-offset-4')}>{status.loading ? '…' : status.value}</span>
            </button>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
