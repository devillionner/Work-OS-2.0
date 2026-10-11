'use client';

import { useState } from 'react';
import { Panel } from '@/components/shell/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { useRemote } from '@/components/views/shared/use-remote';

type GoalHistoryItem = { id: string; key: 'daily_booking_goal' | 'monthly_booking_goal'; effectiveOn: string; value: number; createdAt: number; source: string; version: number };
type UnversionedGoal = { key: GoalHistoryItem['key']; value: number; updatedAt: number };
type Payload = { history?: GoalHistoryItem[]; unversioned?: UnversionedGoal[] };

const sourceLabel = (value: string) => (value === 'manual' ? 'Ручна зміна' : value === 'baseline' ? 'Базове значення' : value === 'import' || value === 'restore' ? 'Імпорт' : 'Системне значення');
const formatDate = (value: string) => {
  if (value === '0001-01-01') return 'початку обліку';
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
};
const formatTime = (epoch: number) => (epoch ? new Intl.DateTimeFormat('uk-UA', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Kyiv' }).format(new Date(epoch * 1000)) : 'час не вказано');

function List({ title, items, unversioned }: { title: string; items: GoalHistoryItem[]; unversioned: UnversionedGoal | null }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2"><h3 className="m-0 text-sm font-medium">{title}</h3><Badge>{items.length}</Badge></div>
      {items.length ? (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((item) => (
            <li key={item.id} className="rounded-inner border border-line px-4 py-3">
              <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium"><span className="font-mono">{item.value}</span> записів</span><span className="font-mono text-xs text-ink-2">{item.source === 'restore' ? 'імпорт' : `v${item.version}`}</span></div>
              <p className="m-0 mt-0.5 text-[13px] text-ink-2">Діє з {formatDate(item.effectiveOn)}</p>
              <p className="m-0 text-xs text-ink-2">{sourceLabel(item.source)} · {formatTime(item.createdAt)}</p>
            </li>
          ))}
        </ol>
      ) : unversioned ? (
        <div className="rounded-inner border border-line px-4 py-3">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium"><span className="font-mono">{unversioned.value}</span> записів</span><span className="text-xs text-ink-2">поточне</span></div>
          <p className="m-0 mt-1 text-[13px] text-ink-2">Історичної версії для цього значення немає, тому дата початку дії невідома. Останнє збереження: {formatTime(unversioned.updatedAt)}. Наступні зміни вже версіонуються.</p>
        </div>
      ) : (
        <EmptyState text="Історія ще порожня." />
      )}
    </section>
  );
}

/** Історія цілей: нова ціль діє від своєї дати й не переписує план минулих днів або місяців. */
export function GoalHistoryPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [attempt, setAttempt] = useState(0);
  const { data, error } = useRemote<Payload>('/api/settings/goal-history', { refresh: attempt, enabled: open, fallback: 'Не вдалося завантажити історію цілей.' });
  const items = data?.history ?? [];
  const unversioned = data?.unversioned ?? [];
  return (
    <Panel open={open} onOpenChange={onOpenChange} title="Історія цілей" subtitle="Нова ціль діє від своєї дати й не переписує план минулих днів або місяців.">
      {error && !data ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="m-0 text-sm text-hot">{error}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Спробувати ще раз</Button>
        </div>
      ) : !data ? (
        <div aria-busy="true" className="flex flex-col gap-3"><Ghost className="h-5 w-1/3 rounded-full" /><Ghost className="h-20 rounded-inner" /><Ghost className="h-20 rounded-inner" /></div>
      ) : (
        <div className="flex flex-col gap-6">
          <List title="Денна ціль" items={items.filter((item) => item.key === 'daily_booking_goal')} unversioned={unversioned.find((item) => item.key === 'daily_booking_goal') ?? null} />
          <List title="Місячна ціль" items={items.filter((item) => item.key === 'monthly_booking_goal')} unversioned={unversioned.find((item) => item.key === 'monthly_booking_goal') ?? null} />
        </div>
      )}
    </Panel>
  );
}
