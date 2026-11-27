'use client';

import { poolSnippet } from '@/lib/telegram-pool/parse';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Check, ChevronDown, Minus, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { scrollToSection } from '@/components/views/platforms/scroll-to-section';
import { CountUp } from '@/components/motion/count-up';
import { ratioPercent } from '@/components/ui/ring';
import { BatchRing } from '@/components/views/platforms/batch-ring';
import { getLatestPace, getLatestStep, subscribeLiveMessages, type AutopostStep } from '@/lib/live-channel';
import { useLiveSynced } from '@/components/views/platforms/use-live-synced';
import { autopostReasonGroup } from '@/components/views/platforms/autopost-reasons';
import { useAutopostHealth } from '@/components/views/platforms/health-line';
import { estimateBatch } from '@/lib/autopost-estimate.mjs';

/** Один чат поточної партії: результат або те, що робиться просто зараз. */
export type AutopostBatchEntry = { jobId: string; name: string; status: 'claimed' | 'sent' | 'failed'; outcome: string | null; code: string | null; at: number; /** Початок тексту з пулу оголошень Telegram, який пішов (чи мав піти) в чат. */ text?: string };
/** Поточна партія платформи: лічильники лише її задач (скасовані задачі старих партій сюди не потрапляють). */
export type AutopostBatch = { id: string; startedAt: number; total: number; sent: number; remaining: number; /** Задачі в роботі (частина `remaining`). */ inProgress: number; /** Задачі в черзі (частина `remaining`). */ queued: number; failed: number; skipped: number; cancelled: number; /** Чати партії, що чекають вибору гілки: не «Не вдалося». */ thread?: number; averageSeconds: number | null; entries: AutopostBatchEntry[] };

type LiveStep = AutopostStep;
const STALE_STEP_MS = 5 * 60_000;
/** Чому чат відкладено (не збій і не архів). */
const POSTPONE_REASON: Record<string, string> = { telegram_chat_restricted: 'зараз писати не можна', telegram_slow_mode: 'повільний режим', slow_mode: 'повільний режим', viber_slow_mode: 'повільний режим', rate_limited: 'ліміт частоти' };
const OUTCOME_LABEL: Record<string, string> = { archived: 'в архів', waiting: 'в «Очікування»', snoozed: 'відкладено', skipped: 'пропущено', resolved: 'вирішено вручну' };

// Останній крок кожної платформи тримає live-канал (lib/live-channel.ts): він приходить подіями й у hello, тож картка, відкрита посеред
// партії чи після того, як телефон приспав вкладку, одразу показує поточний крок.
const stepListeners = new Set<() => void>();
// Задачі, чий результат уже прийшов подією (`process_state` з підсумковим статусом): їхній крок і рядок «у роботі» одразу зникають, не чекаючи
// наступного читання партії (раніше «Зараз» ще кілька секунд показував крок щойно завершеної задачі).
const finishedJobs = new Set<string>();
if (typeof window !== 'undefined') {
  subscribeLiveMessages((message) => {
    // Задача, видана знову (повернена й узята повторно), знову «у роботі»: інакше її крок лишався б прихованим.
    if (message.type === 'process_state' && message.process === 'autopost' && typeof message.jobId === 'string' && message.status === 'running') {
      finishedJobs.delete(message.jobId);
      for (const listener of stepListeners) listener();
    }
    if (message.type === 'process_state' && message.process === 'autopost' && typeof message.jobId === 'string' && message.status && message.status !== 'running') {
      finishedJobs.add(message.jobId);
      if (finishedJobs.size > 300) finishedJobs.delete(finishedJobs.values().next().value as string);
      for (const listener of stepListeners) listener();
    }
    if (message.type === 'hello' || (message.type === 'progress' && message.process === 'autopost_step') || (message.type === 'runner_status' && message.connected === false)) for (const listener of stepListeners) listener();
  });
}
const subscribeStep = (listener: () => void) => { stepListeners.add(listener); return () => { stepListeners.delete(listener); }; };

/** Крок поточної задачі з live-каналу: runner шле «відкриваю чат», «додаю фото» і далі; опитувань бази тут немає. */
function useAutopostStep(platform: 'whatsapp' | 'viber' | 'telegram', active: boolean, now: number): LiveStep | null {
  const step = useSyncExternalStore(subscribeStep, () => getLatestStep(platform), () => null);
  const finished = useSyncExternalStore(subscribeStep, () => Boolean(step && finishedJobs.has(step.jobId)), () => false);
  return active && step && !finished && (now === 0 || now - step.at < STALE_STEP_MS) ? step : null;
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

function entryLabel(entry: AutopostBatchEntry): { icon: 'ok' | 'bad' | 'skip'; text: string } {
  if (entry.status === 'sent') return { icon: 'ok', text: `відправлено о ${clock(entry.at)}` };
  const group = autopostReasonGroup(entry.code).label;
  if (entry.outcome === 'snoozed' && entry.code && POSTPONE_REASON[entry.code]) return { icon: 'skip', text: `відкладено · ${POSTPONE_REASON[entry.code]}` };
  if (entry.outcome && entry.outcome !== 'needs_decision') return { icon: 'skip', text: `${OUTCOME_LABEL[entry.outcome] || 'пропущено'}${entry.code ? ` · ${group.toLowerCase()}` : ''}` };
  return { icon: 'bad', text: group.toLowerCase() };
}

/**
 * Хід партії автопосту, однаково для Viber і WhatsApp: кільце й лічильники поточної партії, що робиться зараз (крок, час на чаті,
 * орієнтовний час до кінця) і згортуваний журнал партії. Оновлюється подіями live-каналу.
 */
/** Що робиться просто зараз: назва чату, крок і час на ньому. */
/**
 * Що робиться зараз: чат і крок задачі в роботі; поки в роботі нічого — або «Чекаю наступну відправку · о 20:58» (інтервал темпу ще не минув),
 * або «Беру наступний чат» (без пауз чи інтервал минув).
 */
function NowBlock({ name, step, now, idle = null }: { name: string; step: LiveStep | null; now: number; idle?: { title: string; detail: string } | null }) {
  const synced = useLiveSynced();
  return (
    <output className="flex flex-col gap-1 rounded-inner border border-line px-4 py-3">
      <p className="m-0 text-xs text-ink-2">Зараз</p>
      <p className="m-0 truncate text-sm font-medium" title={name}>{name || idle?.title || 'Чекаю на runner'}</p>
      <p className="m-0 flex items-center gap-2 text-xs text-ink-2">
        <span>{step ? (step.verify ? `перевірка: ${step.text}` : step.text) : idle ? idle.detail : synced ? 'runner ще не повідомив крок' : 'Оновлюю…'}</span>
        {step && now > 0 ? <span className="ml-auto font-mono tabular-nums">{Math.max(0, Math.round((now - step.startedAt) / 1000))} с</span> : null}
      </p>
    </output>
  );
}

export function AutopostBatchPanel({ batch, running, platform, onStop, stopBusy = false, decisions = 0 }: {
  batch: AutopostBatch | null | undefined; running: boolean; platform: 'whatsapp' | 'viber' | 'telegram';
  /** «Зупинити» в шапці ходу партії (лише поки партія йде). */
  onStop?: () => void; stopBusy?: boolean;
  /** Скільки чатів у «Потребують рішення»: тоді «Не вдалося N» веде до цього списку. */
  decisions?: number;
}) {
  // Пробна відправка перед партією: runner шле крок «Перевіряю … перед партією», і «Зараз» показує його, а не «Чекаю наступну відправку».
  const checking = useAutopostHealth(platform)?.status === 'checking';
  const now = useSecondClock(running || checking);
  const step = useAutopostStep(platform, running || checking, now);
  // Перевірка чату з «Потребують рішення» не належить партії, але крок її теж видно.
  if (!batch || batch.total === 0) return (running || checking) && step ? <NowBlock name={step.name} step={step} now={now} /> : null;
  // Усі задачі партії (у черзі, у роботі й завершені; пізніше додані повтори теж): оброблені — завершені будь-як, без збою чи зі збоєм.
  const done = batch.total - batch.remaining;
  // Кільце й відсоток — частка відправлених від усіх задач, а не оброблених: партія, де чверть чатів не вдалась, не виглядає «100 %».
  const ratio = Math.min(1, batch.sent / batch.total);
  // «Не вдалося» — усе, що закінчилось без відправки: помилка, пропуск за політикою чи рішення власника.
  const notSent = batch.failed + batch.skipped;
  // Партія завершена лише коли немає ні задач у черзі, ні в роботі; зелений стан — коли до того ж відправлено все.
  const active = batch.remaining > 0;
  const allSent = !active && batch.sent === batch.total;
  // Одна оцінка з усіма місцями (картка до запуску, сповіщення, трей): залишок × середній фактичний час на чат за останні задачі платформи.
  const estimate = estimateBatch({ platform, remaining: batch.remaining, finishedAt: batch.entries.filter((entry) => entry.status !== 'claimed').map((entry) => entry.at * 1000) });
  const finishedEntries = batch.entries.filter((entry) => entry.status !== 'claimed');
  const claimed = running ? batch.entries.find((entry) => entry.status === 'claimed' && !finishedJobs.has(entry.jobId)) : undefined;
  // «Зараз» показує крок лише поки в партії справді є задача в роботі (або це ручна перевірка): крок завершеної задачі живе в live-каналі ще кілька хвилин.
  const liveStep = step && (batch.inProgress > 0 || step.verify || checking) ? step : null;
  const currentName = liveStep?.name ?? claimed?.name ?? '';
  // Задачі в роботі немає: інтервал темпу ще не минув — «о 20:58», інакше (в т. ч. «Без пауз») runner одразу бере наступний чат.
  const paceNextAt = getLatestPace(platform)?.nextAt ?? 0;
  const idle = !liveStep && !claimed
    ? (batch.queued > 0 && now > 0 && paceNextAt > now ? { title: 'Чекаю наступну відправку', detail: `за темпом, наступна о ${clock(Math.floor(paceNextAt / 1000))}` } : { title: 'Беру наступний чат', detail: '' })
    : null;

  return (
    <section className="flex flex-col gap-4 rounded-inner border border-line bg-sunken p-4" aria-label="Хід партії автопосту">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 flex items-center gap-2 text-sm font-medium">
          {active ? <i aria-hidden="true" className="size-2 rounded-full bg-ink" /> : <Check aria-hidden="true" strokeWidth={1.5} className={allSent ? 'size-4 text-ok' : 'size-4 text-ink-2'} />}
          {active ? 'Партія виконується' : batch.cancelled > 0 ? 'Партію зупинено' : 'Партію завершено'}
        </p>
        {running && onStop ? <Button variant="outline" size="sm" tone="danger" disabled={stopBusy} onClick={onStop}><Square aria-hidden="true" strokeWidth={1.5} />Зупинити</Button> : null}
      </div>
      <div className="flex items-center gap-5">
        <BatchRing total={batch.total} sent={batch.sent} failed={notSent} busy={batch.inProgress} ok={allSent} size={72} stroke={5} label={`Відправлено ${batch.sent} з ${batch.total}${batch.inProgress ? `, у роботі ${batch.inProgress}` : ''}`}>
          <CountUp value={ratioPercent(ratio)} format={(value) => `${value}%`} />
        </BatchRing>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm text-ink-2">оброблено <span className="font-mono tabular-nums text-ink">{done} з {batch.total}</span></p>
          <p className="m-0 mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
            <span>Відправлено <b className="font-mono font-normal tabular-nums text-ink">{batch.sent}</b></span>
            {notSent > 0 && decisions > 0 ? (
              <button type="button" className="text-hot underline decoration-hot/40 underline-offset-4 hover:decoration-hot" title="До списку «Потребують рішення»" onClick={() => scrollToSection('autopost-decisions')}>Не вдалося <b className="font-mono font-normal tabular-nums">{notSent}</b></button>
            ) : notSent > 0 ? <span className="text-hot" title="Помилка, пропуск за політикою або рішення, що чекає тебе">Не вдалося <b className="font-mono font-normal tabular-nums">{notSent}</b></span> : null}
            {batch.inProgress > 0 ? <span>У роботі <b className="font-mono font-normal tabular-nums text-ink">{batch.inProgress}</b></span> : null}
            <span>Лишилось <b className="font-mono font-normal tabular-nums text-ink">{batch.queued}</b></span>
            {(batch.thread ?? 0) > 0 ? <span title="У цих чатах є гілки: вибери, куди публікувати">Чекають вибору гілки <b className="font-mono font-normal tabular-nums text-ink">{batch.thread}</b></span> : null}
            {batch.cancelled > 0 ? <span>Скасовано <b className="font-mono font-normal tabular-nums text-ink">{batch.cancelled}</b></span> : null}
          </p>
          {active ? <p className="m-0 mt-1.5 text-xs text-ink-2">До кінця: {estimate.text}</p> : null}
        </div>
      </div>

      {running || checking ? <NowBlock name={currentName} step={liveStep} now={now} idle={idle} /> : null}

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
                <li key={entry.jobId} className="flex flex-wrap items-center gap-x-2 text-xs">
                  {label.icon === 'ok' ? <Check aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0 text-ok" /> : label.icon === 'bad' ? <X aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0 text-hot" /> : <Minus aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0 text-ink-3" />}
                  <span className="min-w-0 flex-1 truncate" title={entry.name}>{entry.name}</span>
                  <span className={label.icon === 'bad' ? 'shrink-0 text-hot' : 'shrink-0 text-ink-2'}>{label.text}</span>
                  {entry.text ? <span className="basis-full truncate pl-[22px] text-ink-3" title={entry.text}>{poolSnippet(entry.text, 80)}</span> : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
