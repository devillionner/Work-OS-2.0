'use client';

import { useState } from 'react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { useToast } from '@/components/ui/toast';
import { useRemote } from '@/components/views/shared/use-remote';
import { diffReportText } from '@/lib/reports/diff';
import type { ReportHistoryItem } from '@/lib/reports/history';
import { cn } from '@/lib/utils';
import { formatDate, formatStamp } from './types';

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

/** Версії звіту: перегляд, порівняння з поточною і відновлення як нової версії. */
export function HistoryPanel({ open, onOpenChange, date, currentRevision, onRestored }: { open: boolean; onOpenChange: (open: boolean) => void; date: string; currentRevision: number; onRestored: () => void }) {
  const toast = useToast();
  const [attempt, setAttempt] = useState(0);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const { data, error } = useRemote<{ events: ReportHistoryItem[] }>(`/api/reports/history?date=${encodeURIComponent(date)}`, { refresh: attempt, enabled: open, fallback: 'Не вдалося завантажити історію звіту.' });
  const events = data?.events ?? null;
  const current = events?.[0] ?? null;

  const restore = async (item: ReportHistoryItem) => {
    if (restoringId) return;
    setRestoringId(item.id);
    try {
      const response = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, text: item.text, submitted: item.submittedAt !== null, expectedRevision: currentRevision }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося відновити версію звіту.');
      toast.push({ message: 'Версію відновлено як нову.', tone: 'ok' });
      setAttempt((value) => value + 1);
      onRestored();
      onOpenChange(false);
    } catch (reason) {
      toast.push({ message: reason instanceof Error ? reason.message : 'Не вдалося відновити версію звіту.', tone: 'hot' });
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Panel open={open} onOpenChange={onOpenChange} title="Версії звіту" subtitle={`${formatDate(date)} · відновлення створює нову версію`}>
      {error && !events ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="m-0 text-sm text-hot">{error}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Спробувати ще раз</Button>
        </div>
      ) : !events ? (
        <div aria-busy="true" className="flex flex-col gap-3"><Ghost className="h-24 rounded-inner" /><Ghost className="h-16 rounded-inner" /><Ghost className="h-16 rounded-inner" /></div>
      ) : events.length === 0 ? (
        <EmptyState text="Історія цього звіту ще порожня." />
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {events.map((item, index) => {
            const diff = compareId === item.id && current ? diffReportText(item.text, current.text) : null;
            return (
              <li key={item.id} className="rounded-inner border border-line">
                <details open={index === 0 || compareId === item.id} className="group">
                  <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">Версія {item.revision}</span>
                      <span className="block text-xs text-ink-2">{item.source === 'import' ? 'Імпорт' : 'Ручна зміна'} · {item.submittedAt ? 'здано' : 'чернетка'}</span>
                    </span>
                    <time dateTime={new Date(item.occurredAt * 1000).toISOString()} className="shrink-0 font-mono text-xs text-ink-2">{formatStamp(item.occurredAt)}</time>
                  </summary>
                  <div className="flex flex-col gap-3 px-4 pb-4">
                    {item.manualAdjustments ? <p className="m-0 text-xs text-ink-2">Корекція · оголошення {signed(item.manualAdjustments.publications)} · відгуки {signed(item.manualAdjustments.responses)} · записи {signed(item.manualAdjustments.bookings)}</p> : null}
                    <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap rounded-field bg-sunken p-3 font-mono text-xs leading-relaxed">{item.text || 'Текст відсутній.'}</pre>
                    {index > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" aria-pressed={compareId === item.id} disabled={restoringId !== null} onClick={() => setCompareId((value) => (value === item.id ? null : item.id))}>{compareId === item.id ? 'Сховати порівняння' : 'Порівняти з поточною'}</Button>
                        <Button variant="outline" size="sm" busy={restoringId === item.id} disabled={restoringId !== null} onClick={() => void restore(item)}>{restoringId === item.id ? 'Відновлюємо…' : 'Відновити цю версію'}</Button>
                      </div>
                    ) : null}
                    {diff && current ? (
                      <section aria-label={`Порівняння з версією ${current.revision}`} className="flex flex-col gap-2">
                        <p className="m-0 text-xs text-ink-2">Зміни проти версії {current.revision}: <span className="font-mono">+{diff.added} · −{diff.removed}</span> рядків{diff.truncated ? ` · показано перші ${diff.maxLines} рядків` : ''}</p>
                        <ol className="m-0 list-none overflow-hidden rounded-field border border-line p-0 font-mono text-xs">
                          {diff.operations.map((operation, line) => (
                            <li key={`${operation.kind}:${line}`} className={cn('flex gap-2 px-2 py-0.5', operation.kind !== 'same' && 'bg-raised')}>
                              <span aria-hidden="true" className="w-3 shrink-0 text-ink-2">{operation.kind === 'added' ? '+' : operation.kind === 'removed' ? '−' : ' '}</span>
                              <code className={cn('whitespace-pre-wrap break-words', operation.kind === 'removed' && 'text-ink-2 line-through')}>{operation.text || ' '}</code>
                            </li>
                          ))}
                        </ol>
                      </section>
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
