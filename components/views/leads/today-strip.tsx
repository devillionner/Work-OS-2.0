'use client';

import { useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Ghost } from '@/components/ui/ghost';
import { Surface } from '@/components/ui/surface';
import type { TodayLeadsActivity } from '@/lib/leads/today';
import { labels } from './client';
import { humanError } from '@/components/ui/human-error';

/** Відгуки та записи за день: лічильники й чіпи лідів. Завантажується один раз і за подією синхронізації. */
export function TodayStrip({ refreshKey, onSelect }: { refreshKey: number; onSelect: (id: string) => void }) {
  const [data, setData] = useState<TodayLeadsActivity | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/leads/today', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as TodayLeadsActivity & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити активність лідів за сьогодні.');
        if (!controller.signal.aborted) { setData(body); setError(''); }
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(humanError(reason, 'Не вдалося завантажити активність лідів за сьогодні.')); });
    return () => controller.abort();
  }, [refreshKey]);

  if (error) return <p role="alert" className="m-0 text-sm text-hot">{error}</p>;
  if (!data) return <Ghost className="h-12 rounded-card" />;
  // Порожній день — один тихий рядок, без карток; непорожні групи — компактні картки в один рядок.
  const columns = [
    { key: 'bookings', title: 'Записи сьогодні', items: data.bookings, count: data.counters.bookings },
    { key: 'responses', title: 'Відгуки сьогодні', items: data.responses, count: data.counters.responses },
  ].filter((column) => column.items.length > 0);
  if (!columns.length) return <p className="m-0 px-1 text-sm text-ink-2">Сьогодні ще немає відгуків і записів.</p>;
  return (
    <section aria-label="Відгуки та записи за день" className="grid grid-cols-1 gap-2 @2xl:grid-cols-2 @2xl:gap-3">
      {columns.map((column) => (
        <Surface key={column.key} variant="glass" radius="card" data-reveal className="flex min-w-0 items-center gap-3 px-4 py-2.5">
          <h3 className="m-0 flex shrink-0 items-baseline gap-2 text-sm font-medium">{column.title}<span className="font-mono tabular-nums text-ink-2">{column.count}</span></h3>
          <ul className="m-0 flex min-w-0 list-none gap-2 overflow-x-auto p-0 hide-scrollbar">
            {column.items.map((item) => (
              <li key={item.id} className="shrink-0">
                <button type="button" onClick={() => onSelect(item.id)} className="flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 text-left transition-colors hover:bg-raised active:scale-[0.985]" title={`${labels[item.platform] ?? item.platform} · ${item.subject || 'без предмета'}${column.key === 'bookings' && item.eventCount > 1 ? ` · ${item.eventCount} записи` : ''}`}>
                  <Avatar name={item.name} size={24} />
                  <span className="max-w-[160px] truncate text-[13px] font-medium">{item.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </Surface>
      ))}
    </section>
  );
}
