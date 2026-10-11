'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Ghost } from '@/components/ui/ghost';
import { Surface } from '@/components/ui/surface';
import type { TelegramWarmupSnapshot } from '@/lib/chats/telegram-warmup';
import { cn } from '@/lib/utils';
import { humanError } from '@/components/ui/human-error';

/** План прогріву Telegram-акаунта: ручний чекліст, що не запускає автопостинг і не накладає прихованих лімітів. */
export function WarmupCard({ accountId }: { accountId: string }) {
  const [data, setData] = useState<TelegramWarmupSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/telegram-accounts/warmup?account=${encodeURIComponent(accountId)}`, { cache: 'no-store' });
      const body = await response.json() as { warmup?: TelegramWarmupSnapshot; error?: string };
      if (!response.ok || !body.warmup) throw new Error(body.error || 'Не вдалося завантажити план прогріву.');
      setData(body.warmup);
    } catch (reason) { setError(humanError(reason, 'Не вдалося завантажити план прогріву.')); }
    finally { setLoading(false); }
  }, [accountId]);

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  async function setReady(ready: boolean) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/telegram-accounts/warmup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId, action: ready ? 'complete' : 'reopen' }) });
      const body = await response.json() as { warmup?: TelegramWarmupSnapshot; error?: string };
      if (!response.ok || !body.warmup) throw new Error(body.error || 'Не вдалося оновити план прогріву.');
      setData(body.warmup);
    } catch (reason) { setError(humanError(reason, 'Не вдалося оновити план прогріву.')); }
    finally { setBusy(false); }
  }

  return (
    <Surface variant="glass" radius="card" className="flex flex-col gap-4 p-5" aria-labelledby="warmup-title">
      <div className="flex items-start justify-between gap-3">
        <div><h2 id="warmup-title" className="m-0 text-[15px] font-medium">План прогріву</h2><p className="m-0 mt-1 text-xs text-ink-2">Ручний чекліст для нового Telegram-акаунта. Він не запускає автопостинг і не накладає прихованих лімітів.</p></div>
        <span className={cn('flex shrink-0 items-center gap-1.5 text-xs', data?.ready ? 'text-ok' : 'text-ink-2')}>{data?.ready ? <i aria-hidden="true" className="size-1.5 rounded-full bg-ok" /> : null}{data?.ready ? 'Готовий' : 'У процесі'}</span>
      </div>
      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
      {loading && !data ? <div aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2].map((item) => <Ghost key={item} className="h-12 rounded-inner" />)}</div> : null}
      {data ? (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {data.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-3 rounded-inner border border-line bg-sunken px-4 py-3">
              <span aria-hidden="true" className={cn('mt-0.5 inline-grid size-5 shrink-0 place-items-center rounded-full border', step.done ? 'border-transparent bg-action text-action-ink' : 'border-line-strong')}>{step.done ? <Check strokeWidth={2} className="size-3" /> : null}</span>
              <div className="min-w-0"><p className="m-0 text-sm font-medium">{step.label}</p><p className="m-0 text-xs text-ink-2">{step.instruction}</p>{step.id === 'joined' ? <small className="text-xs text-ink-2">Зафіксовано приєднань: {data.joinedCount}</small> : null}{step.id === 'published' ? <small className="text-xs text-ink-2">Зафіксовано публікацій: {data.publicationCount}</small> : null}</div>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy || loading} onClick={() => void load()}><RefreshCw aria-hidden="true" strokeWidth={1.5} />Оновити</Button>
        {data ? (data.ready
          ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void setReady(false)}>Повернути в прогрів</Button>
          : <Button variant="action" size="sm" disabled={busy || data.joinedCount < 1 || data.publicationCount < 1} onClick={() => void setReady(true)}>Позначити готовим</Button>) : null}
      </div>
    </Surface>
  );
}
