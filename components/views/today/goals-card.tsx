'use client';

import { Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Ring } from '@/components/ui/ring';
import { Surface } from '@/components/ui/surface';
import type { Goal } from '@/components/views/today/use-day';
import { cn } from '@/lib/utils';

/** «Цілі дня»: чотири кільця 2×2 з підписом й «факт / ціль»; клік по кільцю веде в потрібну чергу чи розділ, іконка — розбивка за платформами. */
export function GoalsCard({ goals, size, onBreakdown }: { goals: readonly Goal[]; size: 'phone' | 'desktop'; onBreakdown: () => void }) {
  return (
    <Surface variant="glass" radius="card" data-reveal className={cn('min-w-0', size === 'phone' ? 'p-3.5' : 'p-5')} aria-labelledby="goals-title">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 id="goals-title" className="m-0 text-[13px] font-medium text-ink-2">Цілі дня</h3>
        <Button variant="icon" size="sm" onClick={onBreakdown} title="Розбивка за платформами" aria-label="Розбивка за платформами" className={cn('-mr-2 -my-1.5 text-ink-3', size === 'phone' && 'size-11')}><Layers aria-hidden="true" strokeWidth={1.5} className="size-4" /></Button>
      </div>
      <ul className="m-0 grid list-none grid-cols-2 gap-x-2 gap-y-2.5 p-0">
        {goals.map((goal) => (
          <li key={goal.metric} className="min-w-0">
            <button type="button" onClick={goal.open} title={goal.title} aria-label={`${goal.label}: ${goal.value}${goal.target > 0 ? ` з ${goal.target}` : ''}. ${goal.title}`} className="flex w-full min-w-0 items-center gap-2.5 rounded-[14px] p-1.5 text-left transition-colors duration-150 hover:bg-raised">
              <Ring value={goal.target > 0 ? goal.value / goal.target : 0} tone={goal.tone} size={52} stroke={5} label={`${goal.label}: ${goal.value}${goal.target > 0 ? ` з ${goal.target}` : ''}`} />
              <span className="flex min-w-0 flex-col">
                <span className="text-xs text-ink-2">{goal.label}</span>
                <span className="font-mono text-[15px] font-medium tabular-nums">{goal.value}{goal.target > 0 ? ` / ${goal.target}` : ''}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
