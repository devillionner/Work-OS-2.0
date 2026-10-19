'use client';

import { useEffect, useState } from 'react';
import { AutopostPanel, type AutopostMaterialProps, type AutopostPlan, type AutopostReadiness } from '@/components/views/platforms/autopost-panel';
import type { AutopostAttentionItem, AutopostDecision } from '@/components/views/platforms/autopost-attention';
import type { WhatsAppAutopostProgress } from '@/components/views/platforms/autopost-card';
import { autopostReasonText } from '@/components/views/platforms/autopost-reasons';

/** Стан Viber на ПК оператора, який runner передає через live-канал (процес, доступність, вікно). */
export type ViberRunnerStatus = { state: 'ready' | 'blocked'; reason: string | null; text: string };

/** Орієнтовний час одного чату Viber: за вимірами партій ≈ 20 с. */
const VIBER_SECONDS_PER_CHAT = 20;
/** Скільки чекаємо першого повідомлення runner про стан, перш ніж казати, що щось не так. */
const STATUS_GRACE_MS = 15_000;

/** Автопублікація у Viber через Android у Waydroid: спільна картка автопосту (`AutopostPanel`) зі станом runner і Viber. */
export function ViberAutopostCard({ material, plan, onLoadPlan, progress, attention, batchNote, status, runnerConnected, busy, onDecide, onDecideMany, onStart, onStop, onReset }: {
  material: AutopostMaterialProps;
  plan: AutopostPlan | null;
  onLoadPlan: () => void;
  progress: WhatsAppAutopostProgress | null;
  attention: AutopostAttentionItem[];
  batchNote: string | null;
  status: ViberRunnerStatus | null;
  runnerConnected: boolean | null;
  busy: boolean;
  onDecide: (item: AutopostAttentionItem, decision: AutopostDecision) => void;
  onDecideMany: (items: AutopostAttentionItem[], decision: Exclude<AutopostDecision, 'retry'>) => void;
  /** Скільки чатів поставити в партію (null — усі придатні) і які чати прибрано з цього запуску. */
  onStart: (limit: number | null, exclude: string[]) => void;
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

  const runnerOffline = runnerConnected === false;
  const blocked = status?.state === 'blocked';
  const readiness: AutopostReadiness = runnerOffline
    ? { tone: 'hot', text: 'Runner не відповідає. У треї Work OS обери «Перезапустити runner».' }
    : blocked
      ? { tone: 'warn', text: autopostReasonText(status?.reason) }
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
      secondsPerChat={VIBER_SECONDS_PER_CHAT}
      readiness={readiness}
      settingsTitle="Налаштування Viber на ПК"
      settingsHelp={(
        <ol className="m-0 flex flex-col gap-1.5 pl-5">
          <li>Waydroid на ПК запускається сам; Viber у ньому активований як додатковий пристрій, мова Android англійська.</li>
          <li>У Waydroid встановлена клавіатура ADBKeyBoard (adb install ADBKeyboard.apk): через неї вводиться текст, потім звичайна клавіатура повертається.</li>
          <li>Автозаморожування Waydroid вимкнене (waydroid prop set persist.waydroid.suspend false), щоб відправка йшла й зі схованим вікном.</li>
          <li>Фото й текст спільні з WhatsApp: їх можна змінити тут, у блоці «Що піде в чати».</li>
        </ol>
      )}
      material={material}
      progress={progress}
      attention={attention}
      batchNote={batchNote}
      busy={busy}
      runnerBlocked={runnerOffline}
      onDecide={onDecide}
      onDecideMany={onDecideMany}
      onStart={onStart}
      onStop={onStop}
      onReset={onReset}
    />
  );
}
