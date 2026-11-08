'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatRows, type MeterStatus } from '@/lib/d1-meter-state';
import { usageKindLabel, type DoUsageStatus } from '@/lib/do-usage-state';
import { Row } from './ui';

const LEVEL_TEXT = {
  ok: '',
  warn: ' Уже понад 1 млн: стежимо.',
  stop: ' Понад 1,5 млн: аналітика, дублікати й план автопосту чекають до завтра.',
} as const;

/** «База сьогодні»: скільки рядків D1 прочитано за добу (за UTC) і які маршрути читали найбільше. */
export function D1UsageRow() {
  const [status, setStatus] = useState<(MeterStatus & { dispatcher?: DoUsageStatus }) | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/d1-usage', { cache: 'no-store' });
      if (!response.ok) throw new Error('usage');
      setStatus(await response.json() as MeterStatus & { dispatcher?: DoUsageStatus });
      setFailed(false);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const top = status?.top.slice(0, 3).map((item) => `${item.route.replace(/^GET /, '')} ${formatRows(item.rows)}`).join(' · ');
  const description = failed
    ? 'Лічильник зараз недоступний.'
    : status
      ? `${status.total.toLocaleString('uk-UA')} рядків із 5 млн${top ? ` · топ маршрутів: ${top}` : ''}.${LEVEL_TEXT[status.level]}`
      : 'Читаю лічильник…';
  const dispatcher = status?.dispatcher;
  const dispatcherTop = dispatcher?.top.slice(0, 3).map((item) => `${usageKindLabel(item.kind)} ${item.requests.toLocaleString('uk-UA')}`).join(' · ');
  const dispatcherText = failed
    ? 'Лічильник зараз недоступний.'
    : dispatcher
      ? `${dispatcher.requests.toLocaleString('uk-UA')} запитів із 100 тис.${dispatcherTop ? ` · топ: ${dispatcherTop}` : ''}.${dispatcher.economy ? ' Увімкнено режим економії.' : ''}`
      : 'Читаю лічильник…';
  return (
    <>
      <Row label="База сьогодні" description={description}>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>Оновити</Button>
      </Row>
      <Row label="Диспетчер сьогодні" description={dispatcherText} />
    </>
  );
}
