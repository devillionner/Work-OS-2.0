'use client';

import { useState } from 'react';
import { CheckCircle2, RotateCcw, Send, Square, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Ring } from '@/components/ui/ring';
import { Segmented } from '@/components/ui/segmented';
import { Surface } from '@/components/ui/surface';
import type { WhatsAppAutopostProgress } from '@/components/views/platforms/autopost-card';
import { AutopostAttentionList, AutopostOutcomeSummary, type AutopostAttentionItem, type AutopostDecision } from '@/components/views/platforms/autopost-attention';
import { autopostReasonText } from '@/components/views/platforms/autopost-reasons';

/** Стан Viber на ПК оператора, який runner передає через live-канал (процес, доступність, вікно). */
export type ViberRunnerStatus = { state: 'ready' | 'blocked'; reason: string | null; text: string };

/** Автопублікація у Viber через Android у Waydroid: статус runner і Viber, прогрес партії, старт / стоп / скидання. */
export function ViberAutopostCard({ progress, attention, batchNote, status, runnerConnected, imageReady, busy, queueSize, onDecide, onStart, onStop, onReset }: {
  progress: WhatsAppAutopostProgress | null;
  attention: AutopostAttentionItem[];
  batchNote: string | null;
  status: ViberRunnerStatus | null;
  runnerConnected: boolean | null;
  /** Фото для автопосту (одне на WhatsApp і Viber) уже додане на вкладці автопоста WhatsApp. */
  imageReady: boolean;
  busy: boolean;
  queueSize: number;
  onDecide: (item: AutopostAttentionItem, decision: AutopostDecision) => void;
  /** Скільки чатів поставити в партію; null означає всі придатні. */
  onStart: (limit: number | null) => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const [size, setSize] = useState<'1' | '5' | '20' | 'all'>('all');
  const running = progress?.running === true;
  const hasQueue = Boolean(progress && (progress.total > 0 || progress.cancelled > 0));
  const ratio = progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
  const runnerOffline = runnerConnected === false;
  const blocked = status?.state === 'blocked';
  const readiness = runnerOffline
    ? { tone: 'hot', text: 'Runner на ПК не підключений. Запусти його, щоб розпочати автопост.' }
    : blocked
      ? { tone: 'warn', text: autopostReasonText(status?.reason) }
      : status?.state === 'ready'
        ? { tone: 'ok', text: 'Runner підключений, Waydroid і Viber готові.' }
        : { tone: 'idle', text: 'Стан Viber з’явиться, щойно runner на ПК повідомить про нього.' };

  return (
    <Surface variant="glass" radius="card" className="flex flex-col gap-6 p-5 sm:p-6" aria-labelledby="viber-autopost-title">
      <div>
        <h2 id="viber-autopost-title" className="m-0 text-[17px] font-medium">Автопублікація у Viber</h2>
        <p className="m-0 mt-1 max-w-[62ch] text-sm text-ink-2">Усі придатні чати з черги «Для публікації» (до 100 за запуск) по черзі: Work OS відкриває кожен чат за посиланням у Viber на Android (Waydroid), надсилає фото з текстом із вкладки «Автопост» у WhatsApp й перевіряє, що повідомлення з’явилось.</p>
      </div>

      <output className="m-0 flex items-start gap-2 text-sm">
        <i aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${readiness.tone === 'ok' ? 'bg-ok' : readiness.tone === 'hot' ? 'bg-hot' : readiness.tone === 'warn' ? 'bg-warn' : 'bg-ink-3'}`} />
        <span className={readiness.tone === 'hot' ? 'text-hot' : 'text-ink-2'}>{readiness.text}</span>
      </output>

      {progress && progress.total > 0 ? (
        <section className="flex items-center gap-5 rounded-inner border border-line bg-sunken p-4" aria-label="Прогрес автопоста Viber">
          <Ring value={ratio} tone={progress.failed > 0 ? 'warn' : ratio >= 1 ? 'ok' : 'ink'} size={72} stroke={5} label={`Автопост Viber: ${progress.done} з ${progress.total}`}>{Math.round(ratio * 100)}%</Ring>
          <div className="min-w-0 flex-1">
            <p className="m-0 flex items-center gap-2 text-sm font-medium">
              {running ? <i aria-hidden="true" className="size-2 rounded-full bg-ok" /> : <CheckCircle2 aria-hidden="true" strokeWidth={1.5} className="size-4 text-ok" />}
              {running ? 'Автопост виконується' : 'Автопост завершено'}
              <span className="ml-auto font-mono text-sm font-normal">{progress.done} з {progress.total}</span>
            </p>
            <p className="m-0 mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
              <span>Відправлено <b className="font-mono font-normal text-ink">{progress.sent}</b></span>
              {progress.failed > 0 ? <span className="inline-flex items-center gap-1 text-hot"><XCircle aria-hidden="true" strokeWidth={1.5} className="size-3.5" />Без відправки <b className="font-mono font-normal">{progress.failed}</b></span> : null}
              {progress.pending + progress.claimed > 0 ? <span>Лишилось <b className="font-mono font-normal text-ink">{progress.pending + progress.claimed}</b></span> : null}
              {progress.cancelled > 0 ? <span>Скасовано <b className="font-mono font-normal text-ink">{progress.cancelled}</b></span> : null}
            </p>
            <div className="mt-1.5"><AutopostOutcomeSummary progress={progress} /></div>
            {running ? <p className="m-0 mt-1.5 text-xs text-ink-2">Відправка йде у фоні в Waydroid: ПК можна використовувати як зазвичай.</p> : <p className="m-0 mt-1.5 text-xs text-ink-2">{progress.failed > 0 ? 'Автопост завершено. Чати без відправки розібрано за правилами, решту можна вирішити нижче.' : 'Усі чати в черзі опрацьовано й підтверджено.'}</p>}
          </div>
        </section>
      ) : null}

      {batchNote ? <p className="m-0 text-xs text-ink-2">{batchNote}</p> : null}
      <AutopostAttentionList items={attention} busy={busy} onDecide={onDecide} />

      <section className="flex flex-col gap-2 rounded-inner border border-line p-4" aria-label="Як підготувати автопост">
        <h3 className="m-0 text-sm font-medium">Перед стартом</h3>
        <ol className="m-0 flex flex-col gap-1.5 pl-5 text-sm text-ink-2">
          <li>На ПК запущений Waydroid (waydroid session start), Viber у ньому активований як додатковий пристрій, мова Android англійська.</li>
          <li>Автозаморожування Waydroid вимкнене (waydroid prop set persist.waydroid.suspend false), щоб відправка йшла й зі схованим вікном.</li>
          <li>Фото й текст спільні для WhatsApp і Viber: їх задають на вкладці «Автопост» у WhatsApp (береться збережений текст; якщо його немає, підпис дає оголошення з Бібліотеки).</li>
        </ol>
      </section>

      <div className="flex flex-wrap justify-end gap-2">
        {hasQueue && !running ? <Button variant="outline" disabled={busy} title="Почати спочатку: сьогоднішня черга очиститься, уже відправлені чати лишаться" onClick={onReset}><RotateCcw aria-hidden="true" strokeWidth={1.5} />Скинути чергу</Button> : null}
        {running ? (
          <Button variant="outline" tone="danger" disabled={busy} onClick={onStop}><Square aria-hidden="true" strokeWidth={1.5} />Зупинити автопост</Button>
        ) : (
          <>
            <Segmented<'1' | '5' | '20' | 'all'> label="Скільки чатів у партії" size="sm" value={size} onValueChange={setSize} items={[{ value: '1', label: '1 чат' }, { value: '5', label: '5' }, { value: '20', label: '20' }, { value: 'all', label: 'Усі' }]} />
            <Button variant="action" busy={busy} disabled={runnerOffline || queueSize === 0 || !imageReady} title={imageReady ? undefined : 'Спершу додай фото на вкладці «Автопост» у WhatsApp'} onClick={() => onStart(size === 'all' ? null : Number(size))}><Send aria-hidden="true" strokeWidth={1.5} />{busy ? 'Ставимо в чергу…' : !imageReady ? 'Додай фото в WhatsApp' : queueSize ? `Автопост черги (${size === 'all' ? queueSize : Math.min(Number(size), queueSize)})` : 'Черга порожня'}</Button>
          </>
        )}
      </div>
    </Surface>
  );
}
