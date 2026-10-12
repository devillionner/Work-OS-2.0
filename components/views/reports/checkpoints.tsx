'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Ghost } from '@/components/ui/ghost';
import { useToast } from '@/components/ui/toast';
import { SectionCard } from '@/components/views/shared/card';
import { useRemote } from '@/components/views/shared/use-remote';
import { cn } from '@/lib/utils';
import { formatClock } from './types';
import { humanError } from '@/components/ui/human-error';

type Checkpoint = {
  slot: '13:00' | '16:00' | '19:00';
  state: 'skipped' | 'upcoming' | 'due' | 'submitted';
  reason: string | null;
  submittedAt: number | null;
  text: string | null;
  version: number;
};
type Payload = { date: string; checkpoints: Checkpoint[]; error?: string };

function statusText(item: Checkpoint): string {
  if (item.state === 'submitted') return item.submittedAt ? `Здано ${formatClock(item.submittedAt)}` : 'Здано';
  if (item.state === 'due') return 'Пора здати';
  if (item.state === 'upcoming') return 'Ще не настав';
  return 'Пропускається';
}

const DOT: Record<Checkpoint['state'], string> = {
  submitted: 'bg-ok',
  due: 'bg-hot',
  upcoming: 'border border-ink-3',
  skipped: 'bg-ink-3 opacity-50',
};

/** Проміжні звіти дня: вертикальна шкала з тонкою лінією; час відраховується від початку робочого дня. */
export default function Checkpoints({ date, active, className }: { date: string; active: boolean; className?: string }) {
  const toast = useToast();
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [override, setOverride] = useState<{ date: string; attempt: number; items: Checkpoint[] } | null>(null);
  const { data, error, loading } = useRemote<Payload>(`/api/reports/checkpoints?date=${encodeURIComponent(date)}`, { refresh: attempt, enabled: active, fallback: 'Не вдалося завантажити проміжні звіти.' });
  const items = override && override.date === date && override.attempt === attempt ? override.items : data?.checkpoints ?? null;

  const submit = async (item: Checkpoint) => {
    setSaving(item.slot);
    try {
      const response = await fetch('/api/reports/checkpoints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, slot: item.slot, expectedVersion: item.version }) });
      const body = await response.json() as Payload;
      if (!response.ok) throw new Error(body.error || 'Не вдалося здати проміжний звіт.');
      setOverride({ date, attempt, items: body.checkpoints });
      toast.push({ message: `Проміжний звіт ${item.slot} здано.`, tone: 'ok' });
    } catch (reason) {
      toast.push({ message: humanError(reason, 'Не вдалося здати проміжний звіт.'), tone: 'hot' });
    } finally {
      setSaving(null);
    }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.push({ message: 'Текст проміжного звіту скопійовано.' }); }
    catch { toast.push({ message: 'Не вдалося скопіювати текст.', tone: 'hot' }); }
  };

  return (
    <SectionCard title="Проміжні звіти" hint="Час визначається від початку робочого дня." className={className}>
      {error && !items ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="m-0 text-sm text-hot">{error}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Спробувати ще раз</Button>
        </div>
      ) : !items ? (
        <div aria-busy={loading} className="flex flex-col gap-3"><Ghost className="h-12 rounded-inner" /><Ghost className="h-12 rounded-inner" /><Ghost className="h-12 rounded-inner" /></div>
      ) : items.length === 0 ? (
        <p className="m-0 text-sm text-ink-2">Для цього дня проміжні звіти не потрібні.</p>
      ) : (
        <ol className="relative m-0 flex list-none flex-col gap-5 p-0 pl-6 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line-strong">
          {items.map((item) => (
            <li key={item.slot} className="relative">
              <i aria-hidden="true" className={cn('absolute -left-6 top-[7px] size-[11px] rounded-full ring-4 ring-[var(--solid)]', DOT[item.state])} />
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="min-w-0">
                  <p className="m-0 font-mono text-[15px]">{item.slot}</p>
                  <p className="m-0 text-xs text-ink-2">{statusText(item)}</p>
                  {item.reason ? <p className="m-0 text-xs text-ink-2">{item.reason}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  {item.state === 'due' ? <Button variant="action" size="sm" busy={saving === item.slot} disabled={saving !== null} onClick={() => void submit(item)}>{saving === item.slot ? 'Здаємо…' : 'Здати'}</Button> : null}
                  {item.state === 'submitted' && item.text ? <Button variant="outline" size="sm" onClick={() => void copy(item.text!)}>Копіювати</Button> : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
