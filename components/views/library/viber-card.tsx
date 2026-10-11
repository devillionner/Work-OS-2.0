'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { useToast } from '@/components/ui/toast';
import { viberJobStatus, type Item, type ViberSafeJob } from './types';
import { humanError } from '@/components/ui/human-error';

const pending = (job: ViberSafeJob | null) => job?.status === 'pending' || job?.status === 'claimed';

/**
 * Безпечний тест executor у Viber: лише «Мої нотатки», без publication fact. Стан задачі не опитується
 * за таймером (live-канал Viber-задач не віддає): він перечитується при поверненні на вкладку, появі мережі
 * і кнопкою «Оновити стан».
 */
export function ViberCard({ item }: { item: Item }) {
  const toast = useToast();
  const [job, setJob] = useState<ViberSafeJob | null>(null);
  const [busy, setBusy] = useState(false);
  const jobId = job?.id ?? null;
  const waiting = pending(job);

  const check = useCallback(async () => {
    if (!jobId) return;
    try {
      const response = await fetch(`/api/messenger-automation?viberJobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
      const body = await response.json() as { job?: ViberSafeJob | null };
      if (!response.ok) throw new Error('Viber job status unavailable');
      const next = body.job;
      if (next && next.id === jobId) setJob(next);
    } catch {
      toast.push({ message: 'Не вдалося оновити стан safe-mode.', tone: 'hot' });
    }
  }, [jobId, toast]);

  useEffect(() => {
    if (!waiting) return;
    const wake = () => { if (document.visibilityState === 'visible' && navigator.onLine) void check(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
    };
  }, [waiting, check]);

  const run = async (language: 'uk' | 'ru') => {
    setBusy(true);
    try {
      const response = await fetch('/api/messenger-automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'viber-safe-note', requestKey: `viber_${crypto.randomUUID().replaceAll('-', '')}`, advertisementId: item.id, language }),
      });
      const body = await response.json() as { job?: ViberSafeJob; error?: string };
      if (!response.ok || !body.job) throw new Error(body.error || 'Не вдалося запустити Viber safe-mode тест.');
      setJob(body.job);
      toast.push({ message: 'Safe-mode: задачу створено. Відправлення дозволене лише в «Мої нотатки».' });
    } catch (reason) {
      toast.push({ message: humanError(reason, 'Не вдалося запустити Viber safe-mode тест.'), tone: 'hot' });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const response = await fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel-viber-safe-note', jobId: job.id }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося скасувати Viber safe-mode тест.');
      setJob({ ...job, status: 'cancelled' });
      toast.push({ message: 'Тест скасовано. Публікацію не зараховано.' });
    } catch (reason) {
      toast.push({ message: humanError(reason, 'Не вдалося скасувати Viber safe-mode тест.'), tone: 'hot' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Surface variant="sunken" radius="inner" aria-label="Viber safe-mode" className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-sm font-medium">Viber safe-mode · «Мої нотатки»</h3>
        {job ? <Badge tone={job.status === 'sent' ? 'ok' : job.status === 'failed' ? 'hot' : job.status === 'cancelled' ? 'neutral' : 'warn'}>{viberJobStatus(job.status)}</Badge> : null}
      </div>
      <p className="m-0 text-xs text-ink-2">Тест надсилає матеріал лише в «Мої нотатки» і не рахується як публікація.</p>
      <div className="flex flex-wrap gap-2">
        {item.ukText.trim() ? <Button variant="outline" size="sm" disabled={busy || waiting} onClick={() => void run('uk')}>Тест UA</Button> : null}
        {item.ruText.trim() ? <Button variant="outline" size="sm" disabled={busy || waiting} onClick={() => void run('ru')}>Тест RU</Button> : null}
        {waiting ? <Button variant="ghost" size="sm" onClick={() => void check()}>Оновити стан</Button> : null}
        {waiting ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void cancel()}>Скасувати тест</Button> : null}
      </div>
    </Surface>
  );
}
