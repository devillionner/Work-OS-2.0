'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Check, ChevronDown, Minus, X } from 'lucide-react';
import { Ring } from '@/components/ui/ring';
import { subscribeLiveMessages } from '@/lib/live-channel';
import { autopostReasonGroup } from '@/components/views/platforms/autopost-reasons';

/** Один чат поточної партії: результат або те, що робиться просто зараз. */
export type AutopostBatchEntry = { jobId: string; name: string; status: 'claimed' | 'sent' | 'failed'; outcome: string | null; code: string | null; at: number };
/** Поточна партія платформи: лічильники лише її задач (скасовані задачі старих партій сюди не потрапляють). */
export type AutopostBatch = { id: string; startedAt: number; total: number; sent: number; remaining: number; failed: number; skipped: number; cancelled: number; averageSeconds: number | null; entries: AutopostBatchEntry[] };

type LiveStep = { jobId: string; name: string; text: string; startedAt: number; at: number; verify: boolean };
const STALE_STEP_MS = 5 * 60_000;
const OUTCOME_LABEL: Record<string, string> = { archived: 'в архів', waiting: 'в «Очікування»', snoozed: 'на завтра', skipped: 'пропущено', resolved: 'вирішено вручну' };

// Останній крок кожної платформи тримається поза компонентом: повідомлення приходять і тоді, коли вкладка «Автопост» закрита, а
// відкрита пізніше картка одразу показує поточний крок, не чекаючи наступного.
const latestStep: Record<'whatsapp' | 'viber', LiveStep | null> = { whatsapp: null, viber: null };
const stepListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  subscribeLiveMessages((message) => {
    if (message.type !== 'progress' || message.process !== 'autopost_step') return;
    const platform = message.platform === 'viber' ? 'viber' : 'whatsapp';
    latestStep[platform] = { jobId: String(message.jobId || ''), name: String(message.name || ''), text: String(message.text || ''), startedAt: Number(message.startedAt) || Date.now(), at: Number(message.at) || Date.now(), verify: message.verify === true };
    for (const listener of stepListeners) listener();
  });
}
const subscribeStep = (listener: () => void) => { stepListeners.add(listener); return () => { stepListeners.delete(listener); }; };

/** Крок поточної задачі з live-каналу: runner шле «відкриваю чат», «додаю фото» і далі; опитувань бази тут немає. */
function useAutopostStep(platform: 'whatsapp' | 'viber', active: boolean, now: number): LiveStep | null {
  const step = useSyncExternalStore(subscribeStep, () => latestStep[platform], () => null);
  return active && step && (now === 0 || now - step.at < STALE_STEP_MS) ? step : null;
}

/** Секундний годинник, поки партія виконується; 0 — ще не стартував (час під час рендеру не читаємо). */
function useSecondClock(enabled: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [enabled]);
  return now;
}

const clock = (seconds: number) => new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(seconds * 1000));

function eta(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes < 1 ? 'менш як хвилина' : `близько ${minutes} хв`;
}

function entryLabel(entry: AutopostBatchEntry): { icon: 'ok' | 'bad' | 'skip'; text: string } {
  if (entry.status === 'sent') return { icon: 'ok', text: `відправлено о ${clock(entry.at)}` };
  const group = autopostReasonGroup(entry.code).label;
  if (entry.outcome && entry.outcome !== 'needs_decision') return { icon: 'skip', text: `${OUTCOME_LABEL[entry.outcome] || 'пропущено'}${entry.code ? ` · ${group.toLowerCase()}` : ''}` };
  return { icon: 'bad', text: group.toLowerCase() };
}

/**
 * Хід партії автопосту, однаково для Viber і WhatsApp: кільце й лічильники поточної партії, що робиться зараз (крок, час на чаті,
 * орієнтовний час до кінця) і згортуваний журнал партії. Оновлюється подіями live-каналу.
 */
/** Що робиться просто зараз: назва чату, крок і час на ньому. */
function NowBlock({ name, step, now }: { name: string; step: LiveStep | null; now: number }) {
  return (
    <output className="flex flex-col gap-1 rounded-inner border border-line px-4 py-3">
      <p className="m-0 text-xs text-ink-2">Зараз</p>
      <p className="m-0 truncate text-sm font-medium" title={name}>{name || 'Чекаю на runner'}</p>
      <p className="m-0 flex items-center gap-2 text-xs text-ink-2">
        <span>{step ? (step.verify ? `перевірка: ${step.text}` : step.text) : 'runner ще не повідомив крок'}</span>
        {step && now > 0 ? <span className="ml-auto font-mono tabular-nums">{Math.max(0, Math.round((now - step.startedAt) / 1000))} с</span> : null}
      </p>
    </output>
  );
}

export function AutopostBatchPanel({ batch, running, platform }: { batch: AutopostBatch | null | undefined; running: boolean; platform: 'whatsapp' | 'viber' }) {
  const now = useSecondClock(running);
  const step = useAutopostStep(platform, running, now);
  // Перевірка чату з «Потребують рішення» не належить партії, але крок її теж видно.
  if (!batch || batch.total === 0) return running && step ? <NowBlock name={step.name} step={step} now={now} /> : null;
  const done = batch.total - batch.remaining;
  const ratio = Math.min(1, done / batch.total);
  const secondsLeft = batch.averageSeconds ? batch.remaining * batch.averageSeconds : null;
  const finishedEntries = batch.entries.filter((entry) => entry.status !== 'claimed');
  const claimed = running ? batch.entries.find((entry) => entry.status === 'claimed') : undefined;
  const currentName = step?.name ?? claimed?.name ?? '';

  return (
    <section className="flex flex-col gap-4 rounded-inner border border-line bg-sunken p-4" aria-label="Хід партії автопосту">
      <div className="flex items-center gap-5">
        <Ring value={ratio} tone={batch.failed > 0 ? 'warn' : ratio >= 1 ? 'ok' : 'ink'} size={72} stroke={5} label={`Партія: ${done} з ${batch.total}`}>{Math.round(ratio * 100)}%</Ring>
        <div className="min-w-0 flex-1">
          <p className="m-0 flex items-center gap-2 text-sm font-medium">
            {running ? <i aria-hidden="true" className="size-2 rounded-full bg-ok" /> : <Check aria-hidden="true" strokeWidth={1.5} className="size-4 text-ok" />}
            {running ? 'Партія виконується' : batch.cancelled > 0 && batch.remaining === 0 ? 'Партію зупинено' : 'Партію завершено'}
            <span className="ml-auto font-mono text-sm font-normal tabular-nums">{done} з {batch.total}</span>
          </p>
          <p className="m-0 mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
            <span>Відправлено <b className="font-mono font-normal tabular-nums text-ink">{batch.sent}</b></span>
            <span>Лишилось <b className="font-mono font-normal tabular-nums text-ink">{batch.remaining}</b></span>
            {batch.failed > 0 ? <span className="text-hot">Не вдалося <b className="font-mono font-normal tabular-nums">{batch.failed}</b></span> : null}
            {batch.skipped > 0 ? <span>Пропущено <b className="font-mono font-normal tabular-nums text-ink">{batch.skipped}</b></span> : null}
            {batch.cancelled > 0 ? <span>Скасовано <b className="font-mono font-normal tabular-nums text-ink">{batch.cancelled}</b></span> : null}
          </p>
          {running && secondsLeft ? <p className="m-0 mt-1.5 text-xs text-ink-2">До кінця: {eta(secondsLeft)}</p> : null}
        </div>
      </div>

      {running ? <NowBlock name={currentName} step={step} now={now} /> : null}

      {finishedEntries.length > 0 ? (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-ink-2 [&::-webkit-details-marker]:hidden">
            <ChevronDown aria-hidden="true" strokeWidth={1.5} className="size-4 transition-transform group-open:rotate-180" />
            Журнал партії <span className="font-mono tabular-nums">{finishedEntries.length}</span>
          </summary>
          <ul className="m-0 mt-2 flex max-h-72 list-none flex-col gap-1 overflow-y-auto p-0">
            {finishedEntries.map((entry) => {
              const label = entryLabel(entry);
              return (
                <li key={entry.jobId} className="flex items-center gap-2 text-xs">
                  {label.icon === 'ok' ? <Check aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0 text-ok" /> : label.icon === 'bad' ? <X aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0 text-hot" /> : <Minus aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0 text-ink-3" />}
                  <span className="min-w-0 flex-1 truncate" title={entry.name}>{entry.name}</span>
                  <span className={label.icon === 'bad' ? 'shrink-0 text-hot' : 'shrink-0 text-ink-2'}>{label.text}</span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
