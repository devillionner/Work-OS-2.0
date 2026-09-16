'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, LoaderCircle } from 'lucide-react';

type Props = { onClose: () => void };
type Phase = 'updating' | 'finishing';

const PREVIEW_EXIT_MS = 360;

export function AppUpdateScreenPreview({ onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('updating');
  const [step, setStep] = useState(1);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setStep(2), 700),
      window.setTimeout(() => setStep(3), 1_400),
      window.setTimeout(() => setPhase('finishing'), 2_200),
      window.setTimeout(() => setExiting(true), 3_250),
      window.setTimeout(onClose, 3_250 + PREVIEW_EXIT_MS),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [onClose]);

  const isFinishing = phase === 'finishing';
  const steps = ['Готуємо оновлення', 'Оновлюємо файли', 'Повертаємо до роботи'];

  return (
    <dialog open className={`app-update-backdrop${exiting ? ' is-exiting' : ''}`} aria-labelledby="app-update-preview-title">
      <div className="app-update-card" data-phase={phase}>
        <div className="app-update-brand" aria-hidden="true">W</div>
        <div className={`app-update-icon ${isFinishing ? 'is-complete' : ''}`} aria-hidden="true">
          {isFinishing ? <CheckCircle2 /> : <LoaderCircle className="is-spinning" />}
        </div>
        <p className="eyebrow">Work OS</p>
        <h2 id="app-update-preview-title">{isFinishing ? 'Work OS оновлено' : 'Оновлюємо Work OS'}</h2>
        <p className="app-update-description">
          {isFinishing
            ? 'Відновлюємо ваш екран і актуальні дані…'
            : 'Підтягуємо нову версію та синхронізуємо дані. Нічого натискати не потрібно.'}
        </p>
        <div className="app-update-progress" aria-label="Прогрес оновлення">
          <span style={{ width: isFinishing ? '100%' : `${Math.max(18, step * 33)}%` }} />
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
