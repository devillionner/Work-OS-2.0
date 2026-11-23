'use client';

import { useEffect, useState } from 'react';
import { AutopostPanel, type AutopostMaterialProps, type AutopostPlan, type AutopostReadiness } from '@/components/views/platforms/autopost-panel';
import type { AutopostAttentionItem, AutopostDecision, DecideOptions } from '@/components/views/platforms/autopost-attention';
import type { WhatsAppAutopostProgress } from '@/components/views/platforms/autopost-card';
import { autopostReasonText } from '@/components/views/platforms/autopost-reasons';
import { useSharedSource } from '@/components/views/platforms/library-ads';
import { usePoolPreview } from '@/components/views/platforms/use-pool-preview';
import { PaceEstimate, PaceLine, PaceSegment, secondsPerChat, usePerHour } from '@/components/views/platforms/pace-control';
import type { AutopostPace } from '@/lib/live-channel';

/** Стан Viber на ПК оператора, який runner передає через live-канал (процес, доступність, вікно). */
export type ViberRunnerStatus = { state: 'ready' | 'blocked' | 'busy'; reason: string | null; text: string };

/** Скільки чекаємо першого повідомлення runner про стан, перш ніж казати, що щось не так. */
const STATUS_GRACE_MS = 15_000;

/** Автопублікація у Viber через Android у Waydroid: спільна картка автопосту (`AutopostPanel`) зі станом runner і Viber. */
export function ViberAutopostCard({ material, plan, onLoadPlan, progress, attention, batchNote, status, runnerConnected, pace, busy, onDecide, onDecideMany, onStart, onStop, onReset }: {
  material: AutopostMaterialProps;
  plan: AutopostPlan | null;
  onLoadPlan: () => void;
  progress: WhatsAppAutopostProgress | null;
  attention: AutopostAttentionItem[];
  batchNote: string | null;
  status: ViberRunnerStatus | null;
  runnerConnected: boolean | null;
  pace: AutopostPace | null;
  busy: boolean;
  onDecide: (item: AutopostAttentionItem, decision: AutopostDecision, options?: DecideOptions) => void;
  onDecideMany: (items: AutopostAttentionItem[], decision: AutopostDecision, options?: DecideOptions) => void;
  /** Скільки чатів поставити в партію (null — усі придатні) і які чати прибрано з цього запуску. */
  onStart: (limit: number | null, exclude: string[], perHour: number) => void;
  onStop: () => void;
  onReset: () => void;
}) {
  // «Стан з’явиться» лише перші секунди: далі це вже привід перевірити Waydroid, а не чекати.
  const [waitedLong, setWaitedLong] = useState(false);
  useEffect(() => {
    if (status || runnerConnected !== true) return;
    const timer = window.setTimeout(() => setWaitedLong(true), STATUS_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [status, runnerConnected]);

  const [perHour, setPerHour] = usePerHour('viber');
  const sharedSource = useSharedSource(onLoadPlan);
  const preview = usePoolPreview(null, plan?.library ? 'viber' : null);
  const runnerOffline = runnerConnected === false;
  const blocked = status?.state === 'blocked';
  // Іде партія: runner зайнятий відправкою і про стан Viber окремо не звітує, тож «Viber не відповів» тут було б хибним.
  const running = progress?.running === true;
  const readiness: AutopostReadiness = runnerOffline
    ? { tone: 'hot', text: 'Runner вимкнений. Автопост не працює, поки його не запущено.' }
    : blocked
      ? { tone: 'warn', text: autopostReasonText(status?.reason) }
      : status?.state === 'busy' || (running && status?.state !== 'ready')
        ? { tone: 'ok', text: status?.state === 'busy' && status.text ? status.text : 'Партія виконується: runner надсилає в чати.' }
        : status?.state === 'ready'
          ? { tone: 'ok', text: 'Runner, Waydroid і Viber готові.' }
          : runnerConnected === true && waitedLong
            ? { tone: 'warn', text: 'Runner підключений, але Viber не відповів. Відкрий Waydroid на ПК (він може запускатися до хвилини) або обери «Перезапустити runner» у треї.' }
            : { tone: 'idle', text: 'Перевіряю Waydroid і Viber…' };

  return (
    <AutopostPanel
      platform="viber"
      title="Автопублікація у Viber"
      description="Чати з черги «Для публікації» по одному: Work OS відкриває чат за посиланням у Viber на Android (Waydroid), додає фото з галереї, вводить текст, надсилає й перевіряє, що повідомлення з’явилось у цьому чаті."
      plan={plan}
      onLoadPlan={onLoadPlan}
      secondsPerChat={secondsPerChat('viber', perHour)}
      startNote={perHour > 0 ? `${perHour} на годину: один чат кожні ${Math.round(60 / perHour)} хв, з підтвердженням` : undefined}
      topSlot={(
        <div className="flex flex-col gap-3">
          <PaceEstimate platform="viber" count={plan?.ready ?? 0} perHour={perHour} running={progress?.running === true} />
          <PaceLine pace={pace} progress={progress} running={progress?.running === true} status={null} noun="відправка" />
        </div>
      )}
      startSlot={<PaceSegment platform="viber" value={perHour} onChange={setPerHour} />}
      readiness={readiness}
      settingsTitle="Налаштування Viber на ПК"
      settingsHelp={(
        <ol className="m-0 flex flex-col gap-1.5 pl-5">
          <li>Waydroid на ПК запускається сам; Viber у ньому активований як додатковий пристрій, мова Android англійська.</li>
          <li>У Waydroid встановлена клавіатура ADBKeyBoard (adb install ADBKeyboard.apk): через неї вводиться текст, потім звичайна клавіатура повертається.</li>
          <li>Автозаморожування Waydroid вимкнене (waydroid prop set persist.waydroid.suspend false), щоб відправка йшла й зі схованим вікном.</li>
          <li>Що піде в чати, обираєш у блоці «Що піде в чати»: оголошення з Бібліотеки (з їхніми фото; вибір спільний з WhatsApp і Telegram) або власний текст і фото, які спільні з WhatsApp. Оголошення без фото йде лише текстом.</li>
        </ol>
      )}
      material={{ ...material, source: { mode: plan?.library ? 'library' : 'own', ownAvailable: true, busy: sharedSource.busy, onChange: (mode) => { if (mode !== 'pool') sharedSource.change(mode); }, library: plan?.library ?? null, onSelectionSaved: onLoadPlan } }}
      poolPreview={plan?.library ? preview : undefined}
      progress={progress}
      attention={attention}
      batchNote={batchNote}
      busy={busy}
      runnerBlocked={runnerOffline}
      onDecide={onDecide}
      onDecideMany={onDecideMany}
      onStart={(limit, exclude) => onStart(limit, exclude, perHour)}
      onStop={onStop}
      onReset={onReset}
    />
  );
}
