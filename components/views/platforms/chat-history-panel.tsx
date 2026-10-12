'use client';

import { useEffect, useRef, useState } from 'react';
import { Panel } from '@/components/shell/panel';
import { Chip } from '@/components/ui/chip';
import { Ghost } from '@/components/ui/ghost';
import type { ChatHistoryItem } from '@/lib/chats/history';
import type { ChatAnalyticsEvent, ChatAnalyticsPeriod, ChatAnalyticsSnapshot } from '@/lib/chats/analytics';
import { cn } from '@/lib/utils';
import { humanError } from '@/components/ui/human-error';

type HistoryChat = { id: string; name: string; link: string };
const EVENT_NAMES: Record<string, string> = {
  chat_state_changed: 'Зміна стану', chat_joined: 'Приєднання', publication: 'Публікація', chat_profile_changed: 'Профіль оновлено',
  lead_created: 'Відгук', lesson_booked: 'Запис', curator_booking_pending: 'Запит на запис', lesson_completed: 'Проведений урок',
};
const ACTION_NAMES: Record<string, string> = {
  joined: 'Приєднано', waiting: 'Очікування запрошення', approved: 'Запрошення підтверджено', failed: 'Невдале приєднання', archive: 'Перенесено в архів', restore: 'Відновлено',
  return_to_join: 'Повернуто для приєднання', shortlist: 'Відібрано в чергу приєднання', unshortlist: 'Прибрано з черги приєднання', assign_account: 'Перепризначено акаунт', confirm_leave: 'Вихід із чату підтверджено', undo_leave: 'Підтвердження виходу скасовано', undo_published: 'Публікацію скасовано', rename: 'Чат перейменовано',
};

const cache = new Map<string, { events: ChatHistoryItem[]; analytics: ChatAnalyticsSnapshot | null }>();
const formatTime = (value: number) => new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Kyiv' }).format(new Date(value * 1000));
const formatRange = (value: ChatAnalyticsSnapshot | null) => (!value ? 'Обери період' : value.from ? `${value.from} — ${value.to}` : `До ${value.to}`);

function filterEvents(events: ChatAnalyticsEvent[], metric: string) {
  if (metric === 'publication') return events.filter((event) => event.eventType === 'publication');
  if (metric === 'response') return events.filter((event) => event.eventType === 'lead_created');
  if (metric === 'booking') return events.filter((event) => event.eventType === 'lesson_booked' || event.eventType === 'curator_booking_pending');
  if (metric === 'completed') return events.filter((event) => event.eventType === 'lesson_completed');
  return events;
}

/** Історія чату: результат за період (оголошення → відгуки → записи → проведені) і журнал подій. */
export function ChatHistoryPanel({ open, chat, onClose }: { open: boolean; chat: HistoryChat | null; onClose: () => void }) {
  return (
    <Panel open={open && chat !== null} onOpenChange={(next) => { if (!next) onClose(); }} title="Історія чату" subtitle={chat ? `${chat.name} · ${chat.link}` : undefined}>
      {chat ? <HistoryBody key={chat.id} chat={chat} /> : null}
    </Panel>
  );
}

function HistoryBody({ chat }: { chat: HistoryChat }) {
  const [period, setPeriod] = useState<ChatAnalyticsPeriod>('30');
  const [metric, setMetric] = useState('all');
  const key = `${chat.id}:${period}`;
  const [data, setData] = useState(() => cache.get(key) ?? null);
  const [loadedKey, setLoadedKey] = useState(() => (cache.has(key) ? key : ''));
  const [error, setError] = useState('');
  const latest = useRef(key);

  useEffect(() => {
    latest.current = key;
    const controller = new AbortController();
    fetch(`/api/chats/history?id=${encodeURIComponent(chat.id)}&period=${period}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const value: unknown = await response.json();
        if (!response.ok) throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'Не вдалося завантажити історію.');
        if (controller.signal.aborted || !value || typeof value !== 'object') return;
        const events = Array.isArray((value as { events?: unknown }).events) ? (value as { events: ChatHistoryItem[] }).events : [];
        const analytics = (value as { analytics?: ChatAnalyticsSnapshot }).analytics || null;
        cache.set(key, { events, analytics });
        setData({ events, analytics }); setLoadedKey(key); setError('');
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(humanError(reason, 'Не вдалося завантажити історію.')); });
    return () => controller.abort();
  }, [chat.id, period, key]);

  const ready = loadedKey === key && data;
  const summary = data?.analytics?.summary;
  const rows = summary ? ([['publication', 'Оголошення', summary.publications], ['response', 'Відгуки', summary.responses], ['booking', 'Записи', summary.bookings], ['completed', 'Проведені', summary.completed]] as const) : [];

  return (
    <div className="flex flex-col gap-5">
      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
      <section className="flex flex-col gap-3" aria-label="Результат чату">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 text-xs text-ink-2">{formatRange(data?.analytics ?? null)}</p>
          <fieldset className="m-0 flex gap-1.5 border-0 p-0">
            <legend className="sr-only">Період результату</legend>
            {([['7', '7 днів'], ['30', '30 днів'], ['all', 'Весь час']] as const).map(([value, label]) => <Chip key={value} pressed={period === value} onClick={() => { setMetric('all'); setPeriod(value); }}>{label}</Chip>)}
          </fieldset>
        </div>
        {ready && summary ? (
          <>
            <div className="grid grid-cols-4 gap-2">
              {rows.map(([metricKey, label, value]) => (
                <button key={metricKey} type="button" aria-pressed={metric === metricKey} onClick={() => setMetric(metric === metricKey ? 'all' : metricKey)} className={cn('flex flex-col items-start gap-1 rounded-inner border px-3 py-2.5 text-left transition-colors', metric === metricKey ? 'border-line-strong bg-raised' : 'border-line bg-sunken hover:bg-raised')}>
                  <span className="text-[11px] text-ink-2">{label}</span><strong className="font-mono text-lg font-normal">{value}</strong>
                </button>
              ))}
            </div>
            <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
              <span>Відгук / публікація <strong className="font-mono font-normal text-ink">{summary.responseRate}%</strong></span>
              <span>Запис / відгук <strong className="font-mono font-normal text-ink">{summary.bookingRate}%</strong></span>
              <span>Проведено / запис <strong className="font-mono font-normal text-ink">{summary.completionRate}%</strong></span>
            </p>
            {metric !== 'all' ? (
              <ol className="m-0 flex list-none flex-col gap-1 p-0">
                {filterEvents(data.analytics?.events || [], metric).map((event) => (
                  <li key={event.id} className="flex items-center justify-between gap-3 rounded-field px-2 py-1.5 text-sm hover:bg-raised">
                    <span>{EVENT_NAMES[event.eventType] || event.eventType}{event.leadName ? <span className="text-xs text-ink-2"> · {event.leadName}</span> : null}</span>
                    <time className="font-mono text-[11px] text-ink-2" dateTime={new Date(event.occurredAt * 1000).toISOString()}>{formatTime(event.occurredAt)}</time>
                  </li>
                ))}
              </ol>
            ) : null}
          </>
        ) : null}
      </section>
      {!ready ? <div aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2, 3].map((item) => <Ghost key={item} className="h-12 rounded-inner" />)}</div> : data.events.length ? (
        <ol className="relative m-0 flex list-none flex-col p-0 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line">
          {data.events.map((event) => (
            <li key={event.id} className="relative flex flex-col gap-0.5 py-2 pl-6">
              <i aria-hidden="true" className="absolute left-0 top-[14px] size-[11px] rounded-full border border-line-strong bg-field" />
              <p className="m-0 text-sm font-medium">
                {EVENT_NAMES[event.eventType] || event.eventType}
                {event.eventType === 'chat_state_changed' && typeof event.metadata.action === 'string' ? <span className="font-normal text-ink-2"> · {ACTION_NAMES[event.metadata.action] || event.metadata.action}</span> : null}
                {event.eventType === 'publication' && event.cancelledAt ? <span className="font-normal text-ink-2"> · скасовано</span> : null}
                {event.eventType === 'publication' && event.advertisementTitle ? <span className="font-normal text-ink-2"> · {event.advertisementTitle}</span> : null}
                {event.eventType === 'publication' && (event.metadata.language === 'uk' || event.metadata.language === 'ru') ? <span className="font-normal text-ink-2"> · {event.metadata.language === 'uk' ? 'UA' : 'RU'}</span> : null}
              </p>
              <time className="font-mono text-xs text-ink-2" dateTime={new Date(event.occurredAt * 1000).toISOString()}>{formatTime(event.occurredAt)}</time>
            </li>
          ))}
        </ol>
      ) : <p className="m-0 text-sm text-ink-2">Історія ще порожня.</p>}
    </div>
  );
}
