'use client';

import { useEffect, useState } from 'react';
import { UpdateScreen } from '@/components/shell/update-screen';

const STEP_HOLD_MS = 1_150;
const FINISH_HOLD_MS = 1_900;
const EXIT_MS = 360;

/** Тестовий показ екрана оновлення: ті самі кроки, що й у справжнього оновлення, без перезавантаження сайту. */
export function UpdatePreview({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<'updating' | 'finishing'>('updating');
  const [step, setStep] = useState(1);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const finishingAt = STEP_HOLD_MS * 3;
    const exitAt = finishingAt + FINISH_HOLD_MS;
    const timers = [
      window.setTimeout(() => setStep(2), STEP_HOLD_MS),
      window.setTimeout(() => setStep(3), STEP_HOLD_MS * 2),
      window.setTimeout(() => setPhase('finishing'), finishingAt),
      window.setTimeout(() => setExiting(true), exitAt),
      window.setTimeout(onClose, exitAt + EXIT_MS),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [onClose]);

  return <UpdateScreen phase={phase} step={step} exiting={exiting} note="Тестовий показ: сайт насправді не перезавантажується й не оновлюється." />;
}
