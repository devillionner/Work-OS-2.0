'use client';

import { useState } from 'react';
import { useShell } from '@/components/shell/shell-context';
import { useViewActive } from '@/components/shell/view-pane';
import { humanError } from '@/components/ui/human-error';
import { useToast } from '@/components/ui/toast';
import { useRemote } from '@/components/views/shared/use-remote';
import type { Checkpoint } from '@/components/views/today/day-model';

type Payload = { date: string; checkpoints: Checkpoint[]; error?: string };

/**
 * Проміжні звіти 13:00 / 16:00 / 19:00 з наявного `GET /api/reports/checkpoints`: один запит при відкритті «Сьогодні», далі
 * лише за новою ревізією (live-подія чи здача звіту), без таймерів. «Здати» — наявний `POST` того ж маршруту.
 */
export function useCheckpoints() {
  const { snapshot, syncRevision } = useShell();
  const active = useViewActive();
  const toast = useToast();
  const [saving, setSaving] = useState<string | null>(null);
  const [override, setOverride] = useState<{ date: string; revision: number; items: Checkpoint[] } | null>(null);
  const remote = useRemote<Payload>(`/api/reports/checkpoints?date=${encodeURIComponent(snapshot.today)}`, { refresh: syncRevision, enabled: active, keepPrevious: true, fallback: 'Не вдалося завантажити проміжні звіти.' });
  const items = override && override.date === snapshot.today && override.revision === syncRevision ? override.items : remote.data?.checkpoints ?? null;

  const submit = async (item: Checkpoint) => {
    setSaving(item.slot);
    try {
      const response = await fetch('/api/reports/checkpoints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: snapshot.today, slot: item.slot, expectedVersion: item.version }) });
      const body = await response.json() as Payload;
      if (!response.ok) throw new Error(body.error || 'Не вдалося здати проміжний звіт.');
      setOverride({ date: snapshot.today, revision: syncRevision, items: body.checkpoints });
      toast.push({ message: `Проміжний звіт ${item.slot} здано.`, tone: 'ok' });
    } catch (reason) {
      toast.push({ message: humanError(reason, 'Не вдалося здати проміжний звіт.'), tone: 'hot' });
    } finally {
      setSaving(null);
    }
  };

  return { items, saving, submit };
}
