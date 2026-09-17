'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, LoaderCircle } from 'lucide-react';

type Props = { onClose: () => void };
type Phase = 'updating' | 'finishing';

const PREVIEW_STEP_HOLD_MS = 1_150;
const PREVIEW_FINISH_HOLD_MS = 1_900;
const PREVIEW_EXIT_MS = 480;

export function AppUpdateScreenPreview({ onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('updating');
  const [step, setStep] = useState(1);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const finishingAt = PREVIEW_STEP_HOLD_MS * 3;
    const exitAt = finishingAt + PREVIEW_FINISH_HOLD_MS;
    const timers = [
      window.setTimeout(() => setStep(2), PREVIEW_STEP_HOLD_MS),
      window.setTimeout(() => setStep(3), PREVIEW_STEP_HOLD_MS * 2),
      window.setTimeout(() => setPhase('finishing'), finishingAt),
      window.setTimeout(() => setExiting(true), exitAt),
      window.setTimeout(onClose, exitAt + PREVIEW_EXIT_MS),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [onClose]);

  const isFinishing = phase === 'finishing';
  const statusKey = isFinishing ? 'finishing' : 'updating';
  const statusTitle = isFinishing ? 'Work OS оновлено' : 'Оновлюємо Work OS';
  const statusDescription = isFinishing
    ? 'Відновлюємо ваш екран і актуальні дані…'
    : 'Підтягуємо нову версію та синхронізуємо дані. Нічого натискати не потрібно.';
  const progress = isFinishing ? 100 : Math.min(75, Math.max(25, step * 25));
  const steps = ['Готуємо оновлення', 'Оновлюємо файли', 'Повертаємо до роботи'];

  return (
    <dialog open className={`app-update-backdrop${exiting ? ' is-exiting' : ''}`} aria-labelledby="app-update-preview-title">
      <div className="app-update-card" data-phase={phase}>
        <div className="app-update-brand" aria-hidden="true">W</div>
        <div className={`app-update-icon ${isFinishing ? 'is-complete' : ''}`} aria-hidden="true">
          {isFinishing ? <CheckCircle2 /> : <LoaderCircle className="is-spinning" />}
        </div>
        <p className="eyebrow">Work OS</p>
        <h2 id="app-update-preview-title"><span key={`title-${statusKey}`} className="app-update-status-copy">{statusTitle}</span></h2>
        <p className="app-update-description"><span key={`description-${statusKey}`} className="app-update-status-copy">{statusDescription}</span></p>
        <div className="app-update-progress" aria-label="Прогрес оновлення">
          <span style={{ width: `${progress}%` }} />
        </div>
        <ol className="app-update-steps">
          {steps.map((label, index) => {
            const complete = isFinishing || step > index + 1;
            const current = !isFinishing && step === index + 1;
            return <li key={label} className={complete ? 'is-complete' : current ? 'is-current' : ''}><span>{complete ? '✓' : index + 1}</span>{label}</li>;
          })}
        </ol>
        <small className="app-update-note">Тестовий показ: сайт насправді не перезавантажується й не оновлюється.</small>
      </div>
    </dialog>
  );
}
