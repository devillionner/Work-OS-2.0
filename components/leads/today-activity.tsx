'use client';

import { useEffect, useState } from 'react';
import { CalendarCheck, MessageSquare, ArrowRight, Sparkles, UserCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { TodayLeadsActivity } from '@/lib/leads/today';
import { WorkspaceInlineLoading } from '@/components/workspace-load-state';
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
    <section className="lead-panel leads-today" aria-labelledby="leads-today-title">
      <div className="lead-section-head">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-blue-600" />
            <p className="eyebrow !mb-0">Сьогоднішня активність</p>
          </div>
          <h3 id="leads-today-title" className="mt-1">Відгуки та записи за день</h3>
        </div>
        {data && (
          <div className="lead-actions" aria-label="Лічильники лідів за сьогодні">
            <Badge variant="secondary" className="today-counter-badge">
              <MessageSquare className="size-3 mr-1 text-blue-600" />
              Відгуки: <strong>{data.counters.responses}</strong>
            </Badge>
            <Badge variant="secondary" className="today-counter-badge">
              <CalendarCheck className="size-3 mr-1 text-emerald-600" />
              Записи: <strong>{data.counters.bookings}</strong>
            </Badge>
          </div>
        )}
      </div>
      <p className="muted-note">
        Показує всі події поточного дня. Один контакт не дублюється: якщо сьогодні вже є запис, він відображається у записах.
      </p>
      {error && <p className="lead-error" role="alert">{error}</p>}
      {loading && !data ? (
        <WorkspaceInlineLoading label="Завантажуємо активність…" />
      ) : data ? (
        <div className="leads-today-lists">
          <TodayList
            title="Записи сьогодні"
            icon={<CalendarCheck className="size-4 text-emerald-600" />}
            items={data.bookings}
            onSelect={onSelect}
            showCount
          />
          <TodayList
            title="Відгуки сьогодні"
            icon={<MessageSquare className="size-4 text-blue-600" />}
            items={data.responses}
            onSelect={onSelect}
          />
        </div>
      ) : null}
    </section>
  );
}

function TodayList({
  title,
  icon,
  items,
  onSelect,
  showCount = false,
}: {
  title: string;
  icon?: React.ReactNode;
  items: TodayLeadsActivity['responses'];
  onSelect: (id: string) => void;
  showCount?: boolean;
}) {
  return (
    <section className="leads-today-col" aria-label={title}>
      <div className="leads-today-col-head">
        {icon}
        <h4>{title}</h4>
        <span className="leads-today-count-pill">{items.length}</span>
      </div>
      {items.length ? (
        <ul className="leads-today-items">
          {items.map((item) => (
            <li key={item.id}>
              <div className="leads-today-item-body">
                <div className="leads-today-name-row">
                  <strong>{item.name}</strong>
                  <span className="lead-item-platform-badge">{labels[item.platform] ?? item.platform}</span>
                </div>
                <p>{item.subject || 'Предмет не вказано'}</p>
                {showCount && item.eventCount > 1 && (
                  <span className="leads-today-multi-badge">{item.eventCount} записи за день</span>
                )}
              </div>
              <Button type="button" variant="ghost" size="sm" className="leads-today-open-btn" onClick={() => onSelect(item.id)}>
                <span>Відкрити</span>
                <ArrowRight className="size-3.5 ml-1" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="leads-today-empty">
          <UserCheck className="size-6 opacity-30 mx-auto mb-1" />
          <p>Подій ще немає</p>
        </div>
      )}
    </section>
  );
}

