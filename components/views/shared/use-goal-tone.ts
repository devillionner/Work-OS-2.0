'use client';

import { useShell } from '@/components/shell/shell-context';
import type { RingTone } from '@/components/ui/ring';
import { goalTone } from '@/components/views/shared/pace';
import { useMinuteClock } from '@/components/views/today/use-minute-clock';

/**
 * Тон кільця цілі для плитки «Ціль публікацій» у «Платформах»: та сама `goalTone`, що й у «Сьогодні»; день розпочато,
 * коли знімок має робочий день на сьогодні, час оновлюється щохвилини локально.
 */
export function useGoalTone(): (completed: number, target: number) => RingTone {
  const { snapshot } = useShell();
  const now = useMinuteClock();
  const started = snapshot.workday !== null && snapshot.workday.workDate === snapshot.today;
  return (completed, target) => goalTone(completed, target, started, now);
}
