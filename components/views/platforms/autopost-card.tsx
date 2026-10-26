'use client';

import { AutopostPanel, type AutopostMaterialProps, type AutopostPlan, type AutopostReadiness } from '@/components/views/platforms/autopost-panel';
import type { AutopostAttentionItem, AutopostDecision } from '@/components/views/platforms/autopost-attention';
import type { AutopostBatch } from '@/components/views/platforms/autopost-batch';
import { PaceEstimate, PaceLine, PaceSegment, secondsPerChat, usePerHour } from '@/components/views/platforms/pace-control';
import type { AutopostPace, AutopostPlatformStatus } from '@/lib/live-channel';

export type WhatsAppAutopostImage = { fileName: string; contentType: string; sizeBytes: number; sha256: string; updatedAt: number };
export type WhatsAppAutopostSettled = { archived: number; waiting: number; snoozed: number; skipped: number; decision: number; thread?: number };
export type WhatsAppAutopostProgress = { total: number; done: number; pending: number; claimed: number; sent: number; failed: number; cancelled: number; running: boolean; settled?: WhatsAppAutopostSettled; batch?: AutopostBatch | null };

/** Автопублікація у WhatsApp: спільна картка автопосту (`AutopostPanel`) зі станом runner і підказкою про вкладку WhatsApp Web. */
export function AutopostCard({ material, status, pace, busy, plan, onLoadPlan, runnerConnected, progress, attention, batchNote, onDecide, onDecideMany, onStart, onStop, onReset }: {
  material: AutopostMaterialProps;
  /** Пауза автопосту від runner з причиною (WhatsApp Web не готовий); null — паузи немає. */
  status: AutopostPlatformStatus | null;
  pace: AutopostPace | null;
  busy: boolean;
  plan: AutopostPlan | null;
  onLoadPlan: () => void;
  /** null — зв'язок із live-каналом ще не встановлено. */
  runnerConnected: boolean | null;
  progress: WhatsAppAutopostProgress | null;
  attention: AutopostAttentionItem[];
  /** Підсумок останнього запуску партії: скільки чатів поставлено й чому решту пропущено. */
  batchNote: string | null;
  onDecide: (item: AutopostAttentionItem, decision: AutopostDecision) => void;
  onDecideMany: (items: AutopostAttentionItem[], decision: AutopostDecision) => void;
  onStart: (limit: number | null, exclude: string[], perHour: number) => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const [perHour, setPerHour] = usePerHour('whatsapp');
  const readiness: AutopostReadiness = runnerConnected === false
    ? { tone: 'hot', text: 'Runner на ПК не підключений. У треї Work OS обери «Запустити runner» або «Перезапустити runner».' }
    : runnerConnected && status?.state === 'blocked'
      ? { tone: 'warn', text: status.text || 'Автопост WhatsApp на паузі.' }
      : runnerConnected
      ? { tone: 'ok', text: 'Runner підключений. Вкладка WhatsApp Web у його браузері має бути відкрита й залогінена.' }
      : { tone: 'idle', text: 'Чекаю на зв’язок із runner на ПК…' };
  return (
    <AutopostPanel
      platform="whatsapp"
      title="Автопублікація у WhatsApp"
      description="Чати з черги «Для публікації» по одному: Work OS відкриває чат у WhatsApp Web, додає фото з підписом, надсилає й перевіряє, що повідомлення з’явилось. Кожен чат потрапляє в партію один раз на день."
      plan={plan}
      onLoadPlan={onLoadPlan}
      secondsPerChat={secondsPerChat('whatsapp', perHour)}
      startNote={perHour > 0 ? `${perHour} на годину: один чат кожні ${Math.round(60 / perHour)} хв, з підтвердженням` : undefined}
      topSlot={(
        <div className="flex flex-col gap-3">
          <PaceEstimate platform="whatsapp" count={plan?.ready ?? 0} perHour={perHour} running={progress?.running === true} />
          <PaceLine pace={pace} progress={progress} running={progress?.running === true} status={status} noun="відправка" />
        </div>
      )}
      startSlot={<PaceSegment platform="whatsapp" value={perHour} onChange={setPerHour} />}
      readiness={readiness}
      settingsTitle="Як підготувати автопост WhatsApp"
      settingsHelp={<p className="m-0">Автопост керує вкладкою WhatsApp Web у браузері, до якого підключений runner. Вона має бути відкрита й залогінена в акаунт, з якого публікуєш. Фото й текст спільні з Viber.</p>}
      material={material}
      progress={progress}
      attention={attention}
      batchNote={batchNote}
      busy={busy}
      runnerBlocked={runnerConnected === false}
      onDecide={onDecide}
      onDecideMany={onDecideMany}
      onStart={(limit, exclude) => onStart(limit, exclude, perHour)}
      onStop={onStop}
      onReset={onReset}
    />
  );
}
