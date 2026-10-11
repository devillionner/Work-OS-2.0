'use client';

import { useState } from 'react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { Surface } from '@/components/ui/surface';
import { labels } from '@/components/views/leads/client';
import { formatDate, formatRange, type MetricKey } from './types';
import { useRemote } from './use-remote';

type MetricEvent = {
  id: string;
  eventType: string;
  platform: string | null;
  eventDate: string;
  chatName: string | null;
  leadName: string | null;
  lessonSubject: string | null;
};

type Payload = {
  metric: MetricKey;
  label: string;
  definition: string;
  formula: string;
  range: { from: string; to: string };
  total: number;
  events: MetricEvent[];
};

const METRIC_LABELS: Record<MetricKey, string> = {
  publications: 'Публікації',
  responses: 'Відгуки',
  bookings: 'Записи',
  completed: 'Проведені уроки',
};

const EVENT_LABELS: Record<string, string> = {
  publication: 'Публікація',
  lead_created: 'Відгук',
  lesson_booked: 'Запис',
  curator_booking_pending: 'Запит куратору',
  lesson_completed: 'Проведений урок',
};

/** Inspector показника: що рахуємо, формула і події періоду, з яких складається число. */
export function MetricPanel({ metric, query, onClose }: { metric: MetricKey | null; query: string | null; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const url = metric && query ? `/api/analytics/events?${query}&metric=${metric}` : null;
  const { data, error, loading } = useRemote<Payload>(url, { refresh: attempt, fallback: 'Не вдалося завантажити події.' });

  return (
    <Panel
      open={metric !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={data?.label ?? (metric ? METRIC_LABELS[metric] : 'Показник')}
      subtitle={data ? formatRange(data.range.from, data.range.to) : 'Формула й події вибраного періоду'}
    >
      {error && !data ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="m-0 text-sm text-hot">{error}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Спробувати ще раз</Button>
        </div>
      ) : !data ? (
        <div aria-busy={loading} className="flex flex-col gap-3"><Ghost className="h-24 rounded-inner" /><Ghost className="h-5 w-1/2 rounded-full" /><Ghost className="h-16 rounded-inner" /><Ghost className="h-16 rounded-inner" /></div>
      ) : (
        <div className="flex flex-col gap-5">
          <Surface variant="sunken" radius="inner" className="flex flex-col gap-3 p-4">
            <div><p className="m-0 text-xs font-medium text-ink-2">Що рахуємо</p><p className="m-0 mt-1 text-sm">{data.definition}</p></div>
            <div><p className="m-0 text-xs font-medium text-ink-2">Формула</p><p className="m-0 mt-1 text-sm">{data.formula}</p></div>
          </Surface>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="m-0 text-sm font-medium">Події</h3>
            <span className="text-xs text-ink-2">{data.total > data.events.length ? `Показано ${data.events.length} із ${data.total}` : `${data.total} подій`}</span>
          </div>
          {data.events.length === 0 ? (
            <EmptyState text="У вибраному періоді немає подій для цього показника." />
          ) : (
            <ol className="m-0 flex list-none flex-col p-0">
              {data.events.map((event) => (
                <li key={event.id} className="border-t border-line py-3 first:border-t-0 first:pt-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">{EVENT_LABELS[event.eventType] ?? event.eventType}</span>
                    <span className="font-mono text-xs text-ink-2">{formatDate(event.eventDate)}</span>
                  </div>
                  <p className="m-0 mt-0.5 text-xs text-ink-2">
                    {event.platform ? (labels[event.platform] ?? event.platform) : 'Без платформи'}
                    {' · '}
                    {[event.chatName, event.leadName, event.lessonSubject].filter(Boolean).join(' · ') || 'без додаткових деталей'}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Panel>
  );
}
