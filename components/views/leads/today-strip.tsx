'use client';

import { useEffect, useState } from 'react';
import { CalendarCheck, MessageSquare } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Ghost } from '@/components/ui/ghost';
import { Surface } from '@/components/ui/surface';
import type { TodayLeadsActivity } from '@/lib/leads/today';
import { labels } from './client';

/** Відгуки та записи за день: лічильники й два короткі списки. Завантажується один раз і за подією синхронізації. */
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
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити активність лідів за сьогодні.'); });
    return () => controller.abort();
  }, [refreshKey]);

  if (error) return <p role="alert" className="m-0 text-sm text-hot">{error}</p>;
  if (!data) return <Ghost className="h-24 rounded-card" />;
  const columns = [
    { key: 'bookings', title: 'Записи сьогодні', icon: CalendarCheck, items: data.bookings, count: data.counters.bookings },
    { key: 'responses', title: 'Відгуки сьогодні', icon: MessageSquare, items: data.responses, count: data.counters.responses },
  ];
  return (
    <section aria-label="Відгуки та записи за день" className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
      {columns.map((column) => (
        <Surface key={column.key} variant="glass" radius="card" data-reveal className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="m-0 flex items-center gap-2 text-sm font-medium"><column.icon aria-hidden="true" strokeWidth={1.5} className="size-4 text-ink-2" />{column.title}</h3>
            <span className="font-mono text-lg">{column.count}</span>
          </div>
          {column.items.length ? (
            <ul className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-1 hide-scrollbar">
              {column.items.map((item) => (
                <li key={item.id} className="shrink-0">
                  <button type="button" onClick={() => onSelect(item.id)} className="flex items-center gap-2.5 rounded-full border border-line py-1.5 pl-1.5 pr-4 text-left transition-colors hover:bg-raised active:scale-[0.985]">
                    <Avatar name={item.name} size={28} />
                    <span className="min-w-0">
                      <span className="block max-w-[160px] truncate text-[13px] font-medium">{item.name}</span>
                      <span className="block max-w-[160px] truncate text-[11px] text-ink-2">{labels[item.platform] ?? item.platform} · {item.subject || 'без предмета'}{column.key === 'bookings' && item.eventCount > 1 ? ` · ${item.eventCount} записи` : ''}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-sm text-ink-2">Подій ще немає.</p>
          )}
        </Surface>
      ))}
    </section>
  );
}
