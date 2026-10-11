'use client';

import { Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type UpdateScreenPhase = 'updating' | 'finishing' | 'error';

const STEPS = ['Готуємо оновлення', 'Оновлюємо файли', 'Повертаємо до роботи'];

/** Екран оновлення Work OS: використовується справжнім автооновленням і тестовим показом у налаштуваннях. */
export function UpdateScreen({ phase, step, exiting, note, onRetry }: { phase: UpdateScreenPhase; step: number; exiting: boolean; note: string; onRetry?: () => void }) {
  const isError = phase === 'error';
  const isFinishing = phase === 'finishing';
  const title = isError ? 'Не вдалося завершити оновлення' : isFinishing ? 'Work OS оновлено' : 'Оновлюємо Work OS';
  const description = isError
    ? 'Поточна версія залишається доступною. Можна безпечно повторити спробу.'
    : isFinishing
      ? 'Повертаємо вас до роботи з актуальними даними…'
      : 'Підтягуємо нову версію й синхронізуємо дані. Нічого натискати не потрібно.';
  const progress = isFinishing ? 100 : Math.min(75, Math.max(25, step * 25));

  return (
    <dialog
      open
      className={`app-update-backdrop fixed inset-0 z-[95] m-0 grid h-dvh max-h-none w-screen max-w-none place-items-center border-0 bg-scrim p-4 text-ink transition-opacity duration-500 ${exiting ? 'opacity-0' : 'opacity-100'}`}
      aria-labelledby="app-update-title"
      aria-describedby="app-update-description"
    >
      <div className="glass-strong frost shadow-float flex w-[min(420px,100%)] flex-col gap-5 rounded-panel p-7" data-phase={phase}>
        <span aria-hidden="true" className="relative inline-grid size-12 place-items-center rounded-full border border-line-strong text-[17px] font-medium">
          W
          {isFinishing ? <Check className="absolute -right-1 -top-1 size-5 rounded-full bg-ok p-0.5 text-action-ink" /> : null}
        </span>
        <div className="flex flex-col gap-2">
          <h2 id="app-update-title" className="m-0 text-[22px] font-medium tracking-[-0.02em]" aria-live="polite">{title}</h2>
          <p id="app-update-description" className="m-0 text-sm text-ink-2">{description}</p>
        </div>
        {!isError ? (
          <>
            <progress className="sr-only" aria-label="Прогрес оновлення" max={100} value={progress} />
            <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-line">
              <div className="h-full origin-left rounded-full bg-ink" style={{ transform: `scaleX(${progress / 100})`, transition: 'transform 0.6s var(--ease-out)' }} />
            </div>
            <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
              {STEPS.map((label, index) => {
                const complete = isFinishing || step > index + 1;
                const current = !isFinishing && step === index + 1;
                return (
                  <li key={label} className={`flex items-center gap-3 ${complete || current ? 'text-ink' : 'text-ink-2'}`}>
                    <span className={`inline-grid size-5 place-items-center rounded-full border text-[11px] ${complete ? 'border-transparent bg-action text-action-ink' : 'border-line-strong'}`}>{complete ? '✓' : index + 1}</span>
                    {label}
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <Button variant="action" onClick={onRetry}>
            <RefreshCw aria-hidden="true" strokeWidth={1.5} />
            Спробувати ще раз
          </Button>
        )}
        <small className="text-xs text-ink-2">{note}</small>
      </div>
    </dialog>
  );
}
