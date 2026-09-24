'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { WorkspaceInlineLoading } from '@/components/workspace-load-state';

type GoalHistoryItem = {
  id: string;
  key: 'daily_booking_goal' | 'monthly_booking_goal';
  effectiveOn: string;
  value: number;
  createdAt: number;
  source: string;
  version: number;
};

type UnversionedGoal = {
  key: GoalHistoryItem['key'];
  value: number;
  updatedAt: number;
};

type Payload = { history?: GoalHistoryItem[]; unversioned?: UnversionedGoal[]; error?: string };

export function GoalHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<GoalHistoryItem[]>([]);
  const [unversioned, setUnversioned] = useState<UnversionedGoal[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      setError('');
    });
    fetch('/api/settings/goal-history', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as Payload;
        if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити історію цілей.');
        if (!controller.signal.aborted) {
          setItems(body.history || []);
          setUnversioned(body.unversioned || []);
          setLoaded(true);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити історію цілей.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => {
      active = false;
      controller.abort();
    };
  }, [open]);

  const daily = items.filter((item) => item.key === 'daily_booking_goal');
  const monthly = items.filter((item) => item.key === 'monthly_booking_goal');
  const dailyUnversioned = unversioned.find((item) => item.key === 'daily_booking_goal') ?? null;
  const monthlyUnversioned = unversioned.find((item) => item.key === 'monthly_booking_goal') ?? null;

  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent className="report-history-dialog">
      <DialogHeader>
        <DialogTitle>Історія цілей</DialogTitle>
        <DialogDescription>Нова ціль діє від своєї дати й не переписує план минулих днів або місяців.</DialogDescription>
      </DialogHeader>
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {loading&&!loaded ? <WorkspaceInlineLoading label="Завантажуємо історію…"/> : <>{loading?<WorkspaceInlineLoading label="Оновлюємо історію…"/>:null}<div className="grid gap-4 md:grid-cols-2">
        <GoalHistoryList title="Денна ціль" items={daily} unversioned={dailyUnversioned} />
        <GoalHistoryList title="Місячна ціль" items={monthly} unversioned={monthlyUnversioned} />
      </div></>}
      <div className="dialog-actions"><Button variant="outline" onClick={onClose}>Закрити</Button></div>
    </DialogContent>
  </Dialog>;
}

function GoalHistoryList({ title, items, unversioned }: { title: string; items: GoalHistoryItem[]; unversioned: UnversionedGoal | null }) {
  return <section aria-label={title} className="rounded-xl border border-border/70 p-3">
    <div className="mb-2 flex items-center justify-between gap-2"><strong>{title}</strong><Badge variant="outline">{items.length} верс.</Badge></div>
    {items.length ? <ol className="grid gap-2">{items.map((item) => <li key={item.id} className="rounded-lg bg-muted/30 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2"><strong>{item.value} записів</strong><span>{item.source === 'restore' ? 'імпорт' : `v${item.version}`}</span></div>
      <div className="text-muted-foreground">Діє з {formatDate(item.effectiveOn)}</div>
      <small className="text-muted-foreground">{sourceLabel(item.source)} · {formatTime(item.createdAt)}</small>
    </li>)}</ol> : unversioned ? <div className="rounded-lg bg-muted/30 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2"><strong>{unversioned.value} записів</strong><Badge variant="secondary">поточне</Badge></div>
      <p className="mt-1 text-muted-foreground">Історичної версії для цього значення немає, тому дата початку дії невідома.</p>
      <small className="text-muted-foreground">Останнє збереження: {formatTime(unversioned.updatedAt)}. Наступні зміни вже версіонуються.</small>
    </div> : <p className="muted-note">Історія ще порожня.</p>}
  </section>;
}

function sourceLabel(value: string) {
  if (value === 'manual') return 'Ручна зміна';
  if (value === 'baseline') return 'Базове значення';
  if (value === 'import' || value === 'restore') return 'Імпорт з Prototype';
  return 'Системне значення';
}
function formatDate(value: string) {
  if (value === '0001-01-01') return 'початку обліку';
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}
function formatTime(epoch: number) {
  if (!epoch) return 'час не вказано';
  return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Kyiv' }).format(new Date(epoch * 1000));
}
