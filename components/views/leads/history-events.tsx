'use client';

import { useEffect, useState } from 'react';
import { Ghost } from '@/components/ui/ghost';
import type { LeadHistoryItem } from '@/lib/leads/history';
import { EditDialog } from './form';
import { humanError } from '@/components/ui/human-error';

const LEAD_EVENTS: Record<string, string> = {
  lead_created: 'Ліда створено',
  lead_updated: 'Контакт оновлено',
  lead_archived: 'Ліда архівовано',
  lead_restored: 'Ліда відновлено',
  lead_response_cancelled: 'Відгук скасовано',
  lead_response_restored: 'Відгук відновлено',
  first_reply_recorded: 'Першу відповідь зафіксовано',
  curator_request_submitted: 'Запит куратору створено',
  curator_booking_pending: 'Запит куратору очікує відповіді',
  curator_request_cancelled: 'Запит куратору скасовано',
  lesson_booked: 'Урок записано',
  lesson_rescheduled: 'Урок перенесено',
  lesson_updated: 'Урок оновлено',
  lesson_completed: 'Урок проведено',
  lesson_cancelled: 'Урок скасовано',
  lesson_no_show: 'Неявка на урок',
  reminder_sent: 'Нагадування відправлено',
  reminder_skipped: 'Нагадування пропущено',
  script_used: 'Скрипт використано',
};

const cache = new Map<string, LeadHistoryItem[]>();

function formatTime(value: number) {
  return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Kyiv' }).format(new Date(value * 1000));
}

/** Хронологія подій ліда або одного уроку; кеш на сеанс, повторне відкриття не блимає завантаженням. */
export function HistoryList({ leadId, lessonId }: { leadId: string; lessonId?: string }) {
  const cacheKey = `${leadId}:${lessonId ?? ''}`;
  const [events, setEvents] = useState<LeadHistoryItem[] | null>(() => cache.get(cacheKey) ?? null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const url = `/api/leads/history?id=${encodeURIComponent(leadId)}${lessonId ? `&lessonId=${encodeURIComponent(lessonId)}` : ''}`;
    fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const value: unknown = await response.json();
        if (!response.ok) throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'Не вдалося завантажити історію.');
        if (!value || typeof value !== 'object' || !Array.isArray((value as { events?: unknown }).events)) throw new Error('Не вдалося прочитати історію.');
        const next = (value as { events: LeadHistoryItem[] }).events;
        cache.set(cacheKey, next);
        if (!controller.signal.aborted) { setEvents(next); setError(''); }
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(humanError(reason, 'Не вдалося завантажити історію.')); });
    return () => controller.abort();
  }, [cacheKey, leadId, lessonId]);

  if (error && !events) return <p role="alert" className="m-0 text-sm text-hot">{error}</p>;
  if (!events) return <div aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2, 3].map((item) => <Ghost key={item} className="h-12 rounded-inner" />)}</div>;
  if (!events.length) return <p className="m-0 text-sm text-ink-2">Історія ще порожня.</p>;
  return (
    <ol className="relative m-0 flex list-none flex-col gap-0 p-0 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line">
      {events.map((event) => (
        <li key={event.id} className="relative flex flex-col gap-0.5 py-2 pl-6">
          <i aria-hidden="true" className="absolute left-0 top-[14px] size-[11px] rounded-full border border-line-strong bg-field" />
          <p className="m-0 text-sm font-medium">{LEAD_EVENTS[event.eventType] || event.eventType}{event.cancelledAt !== null ? <span className="font-normal text-ink-2"> · скасовано</span> : null}</p>
          {typeof event.metadata.reason === 'string' && event.metadata.reason ? <p className="m-0 text-xs text-ink-2">{event.metadata.reason}</p> : null}
          {event.eventType === 'script_used' && typeof event.metadata.title === 'string' ? <p className="m-0 text-xs text-ink-2">{event.metadata.title}{event.metadata.language === 'ru' ? ' · RU' : ' · UA'}</p> : null}
          <time className="font-mono text-xs text-ink-2" dateTime={new Date(event.occurredAt * 1000).toISOString()}>{formatTime(event.occurredAt)}</time>
        </li>
      ))}
    </ol>
  );
}

/** Історія одного уроку — крок усередині панелі ліда. */
export function LessonHistory({ lesson, close }: { lesson: { id: string; leadId: string; subject: string; date: string }; close: () => void }) {
  const [year, month, day] = lesson.date.split('-');
  return (
    <EditDialog title="Історія уроку" description={`${lesson.subject} · ${day}.${month}.${year}`} close={close}>
      <HistoryList leadId={lesson.leadId} lessonId={lesson.id} />
    </EditDialog>
  );
}
