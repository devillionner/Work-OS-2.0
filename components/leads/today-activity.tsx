'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { TodayLeadsActivity } from '@/lib/leads/today';
import { labels } from './client';

export function TodayLeadsPanel({
  refreshKey,
  onSelect,
}: {
  refreshKey: number;
  onSelect: (id: string) => void;
}) {
  const [data, setData] = useState<TodayLeadsActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      setError('');
    });
    void fetch('/api/leads/today', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as TodayLeadsActivity & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити активність лідів за сьогодні.');
        if (!controller.signal.aborted) setData(body);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити активність лідів за сьогодні.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [refreshKey]);

  return (
    <section
      className="lead-panel leads-today"
      aria-labelledby="leads-today-title"
      aria-busy={loading}
    >
      <div className="lead-section-head">
        <div>
          <p className="eyebrow">Сьогодні</p>
          <h3 id="leads-today-title">Відгуки та записи</h3>
        </div>
        {data && (
          <div className="lead-actions" aria-label="Лічильники лідів за сьогодні">
            <Badge variant="outline">Відгуки: {data.counters.responses}</Badge>
            <Badge variant="outline">Записи: {data.counters.bookings}</Badge>
          </div>
        )}
      </div>
      <p className="muted-note">
        Лічильники показують усі події. У списках один контакт не дублюється: якщо сьогодні вже є запис, він показаний у записах.
      </p>
      {error && <p className="lead-error" role="alert">{error}</p>}
      {loading && !data ? (
        <p className="muted-note" role="status">Завантажуємо активність…</p>
      ) : data ? (
        <div className="leads-today-lists">
          <TodayList title="Записи сьогодні" items={data.bookings} onSelect={onSelect} showCount />
          <TodayList title="Відгуки сьогодні" items={data.responses} onSelect={onSelect} />
        </div>
      ) : null}
    </section>
  );
}

function TodayList({
  title,
  items,
  onSelect,
  showCount = false,
}: {
  title: string;
  items: TodayLeadsActivity['responses'];
  onSelect: (id: string) => void;
  showCount?: boolean;
}) {
  return (
    <section aria-label={title}>
      <h4>{title}</h4>
      {items.length ? (
        <ul className="lead-simple-list">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <p>{item.subject || 'Предмет не вказано'} · {labels[item.platform] ?? item.platform}</p>
                {showCount && item.eventCount > 1 && <small>{item.eventCount} записи за день</small>}
              </div>
              <Button
                type="button"
                variant="ghost"
                aria-label={`Відкрити ліда ${item.name}`}
                onClick={() => onSelect(item.id)}
              >
                Відкрити
              </Button>
            </li>
          ))}
        </ul>
      ) : <p className="muted-note">Поки немає.</p>}
    </section>
  );
}