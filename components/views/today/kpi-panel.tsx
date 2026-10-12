'use client';

import { useState } from 'react';
import { Panel } from '@/components/shell/panel';
import { useShell } from '@/components/shell/shell-context';
import type { ViewKey } from '@/components/shell/views';
import { Button } from '@/components/ui/button';

export type Metric = 'publications' | 'joined' | 'responses' | 'bookings';

const META: Record<Metric, { title: string; goal: 'publicationGoal' | 'chatGoal' | 'responseGoal' | 'bookingGoal'; view: ViewKey; open: string }> = {
  publications: { title: 'Публікації сьогодні', goal: 'publicationGoal', view: 'platforms', open: 'Відкрити платформи' },
  joined: { title: 'Нові чати сьогодні', goal: 'chatGoal', view: 'platforms', open: 'Відкрити платформи' },
  responses: { title: 'Відгуки сьогодні', goal: 'responseGoal', view: 'leads', open: 'Відкрити лідів' },
  bookings: { title: 'Записи сьогодні', goal: 'bookingGoal', view: 'analytics', open: 'Відкрити аналітику' },
};

/** Розбивка показника за платформами в Inspector: замість окремої таблиці на екрані «Сьогодні». */
export function KpiPanel({ metric, onClose }: { metric: Metric | null; onClose: () => void }) {
  const { snapshot, navigate } = useShell();
  // Пам'ятаємо останній показник, щоб вміст не блимав порожнім, поки панель закривається.
  const [last, setLast] = useState<Metric>('publications');
  if (metric && metric !== last) setLast(metric);
  const shown = metric ?? last;
  const meta = META[shown];
  const goal = snapshot[meta.goal];
  const rows = snapshot.platforms
    .filter((platform) => snapshot.enabledPlatforms.includes(platform.key) || platform.key === 'threads' || platform.key === 'unknown')
    .map((platform) => ({ key: platform.key, name: platform.name, value: platform[shown] }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <Panel
      open={metric !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={meta.title}
      subtitle={goal.target > 0 ? `${total} із цілі ${goal.target}` : `${total} за день`}
      footer={<Button variant="outline" size="md" className="w-full" onClick={() => { onClose(); navigate(meta.view); }}>{meta.open}</Button>}
    >
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0">
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span>{row.name}</span>
              <span className="font-mono tabular-nums">{row.value}</span>
            </span>
            <span aria-hidden="true" className="block h-0.5 overflow-hidden rounded-full bg-line">
              <span className="block h-full origin-left rounded-full bg-ink" style={{ transform: `scaleX(${row.value / max})`, transition: 'transform 0.32s var(--ease-out)' }} />
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
