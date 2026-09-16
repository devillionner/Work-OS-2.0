'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type GoalHistoryItem = {
  id: string;
  key: 'daily_booking_goal' | 'monthly_booking_goal';
  effectiveOn: string;
  value: number;
  createdAt: number;
  source: string;
  version: number;
};

type Payload = { history?: GoalHistoryItem[]; error?: string };

export function GoalHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<GoalHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
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
        if (!controller.signal.aborted) setItems(body.history || []);
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

  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent className="report-history-dialog">
      <DialogHeader>
        <DialogTitle>Історія цілей</DialogTitle>
        <DialogDescription>Нова ціль діє від своєї дати й не переписує план минулих днів або місяців.</DialogDescription>
      </DialogHeader>
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {loading ? <output className="workspace-loading">Завантажуємо історію…</output> : <div className="grid gap-4 md:grid-cols-2">
        <GoalHistoryList title="Денна ціль" items={daily} />
        <GoalHistoryList title="Місячна ціль" items={monthly} />
      </div>}
      <div className="dialog-actions"><Button variant="outline" onClick={onClose}>Закрити</Button></div>
    </DialogContent>
  </Dialog>;
}

function GoalHistoryList({ title, items }: { title: string; items: GoalHistoryItem[] }) {
  return <section aria-label={title} className="rounded-xl border border-border/70 p-3">
    <div className="mb-2 flex items-center justify-between gap-2"><strong>{title}</strong><Badge variant="outline">{items.length} верс.</Badge></div>
    {items.length ? <ol className="grid gap-2">{items.map((item) => <li key={item.id} className="rounded-lg bg-muted/30 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2"><strong>{item.value} записів</strong><span>v{item.version}</span></div>
      <div className="text-muted-foreground">Діє з {formatDate(item.effectiveOn)}</div>
      <small className="text-muted-foreground">{sourceLabel(item.source)} · {formatTime(item.createdAt)}</small>
    </li>)}</ol> : <p className="muted-note">Історія ще порожня.</p>}
  </section>;
}

function sourceLabel(value: string) {
  if (value === 'manual') return 'Ручна зміна';
  if (value === 'baseline') return 'Базове значення';
  if (value === 'import') return 'Імпорт';
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
