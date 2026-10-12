'use client';

import { useEffect, useRef, useState } from 'react';
import { useShell } from '@/components/shell/shell-context';
import { humanError } from '@/components/ui/human-error';
import { useToast } from '@/components/ui/toast';
import { createBrowserCommandClient, getJson } from '@/components/views/leads/client';
import { taskKey, type LeadTask } from '@/components/views/today/day-model';
import type { LeadDetail } from '@/lib/leads/application/queries';

/** Скільки мілісекунд «Готово» можна скасувати: дія на сервері йде лише після цього часу. */
const UNDO_MS = 8000;

/**
 * Дії над нагадуваннями з черги лідів. «Готово»: нагадування уроку → `reminder_mark sent`, повторний контакт → прибрати дату
 * контакту. Рядок зникає одразу, Toast дає 8 с на «Скасувати», а запит іде лише після цього часу (API не вміє «розмітити»
 * надіслане); при виході з екрана чи згортанні вкладки дія виконується одразу.
 */
export function useReminderActions() {
  const { snapshot, user, refreshSnapshot } = useShell();
  const toast = useToast();
  const [command] = useState(() => createBrowserCommandClient(`${user.email}:today-reminders`));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const pending = useRef(new Map<string, { timer: number; execute: () => Promise<void> }>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const refresh = useRef(refreshSnapshot);
  useEffect(() => { refresh.current = refreshSnapshot; });

  const unhide = (id: string) => setHidden((current) => { const next = new Set(current); next.delete(id); return next; });

  // Дії йдуть по черзі (клієнт команд не вміє дві одночасно), а при виході з екрана чи згортанні вкладки виконуються одразу.
  useEffect(() => {
    const flush = () => { for (const entry of pending.current.values()) void entry.execute(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', flush); flush(); };
  }, []);

  const schedule = (task: LeadTask, message: string, run: () => Promise<void>) => {
    const id = taskKey(task);
    if (pending.current.has(id)) return;
    setHidden((current) => new Set(current).add(id));
    const execute = () => {
      const entry = pending.current.get(id);
      if (!entry) return Promise.resolve();
      window.clearTimeout(entry.timer);
      pending.current.delete(id);
      queue.current = queue.current.then(async () => {
        try { await run(); refresh.current(); }
        catch (reason) { unhide(id); toast.push({ message: humanError(reason, 'Не вдалося виконати дію.'), tone: 'hot' }); }
      });
      return queue.current;
    };
    const timer = window.setTimeout(() => void execute(), UNDO_MS);
    pending.current.set(id, { timer, execute });
    toast.push({ message, duration: UNDO_MS, action: { label: 'Скасувати', onClick: () => { window.clearTimeout(timer); pending.current.delete(id); unhide(id); } } });
  };

  const detailVersion = async (task: LeadTask) => (await getJson<LeadDetail>(`/api/leads?id=${encodeURIComponent(task.leadId)}`)).lead.version;

  const done = (task: LeadTask) => {
    if (task.kind === 'reminder') {
      schedule(task, 'Нагадування позначено як надіслане.', async () => {
        if (!task.reminderId || task.leadVersion === null) throw new Error('Не вдалося оновити нагадування.');
        await command('reminder_mark', { state: 'sent' }, { id: task.leadId, version: task.leadVersion }, task.reminderId);
      });
      return;
    }
    schedule(task, 'Контакт позначено виконаним.', async () => {
      await command('update', { nextContactAt: null }, { id: task.leadId, version: await detailVersion(task) });
    });
  };

  return { tasks: snapshot.leadTasks.filter((task) => !hidden.has(taskKey(task))), done };
}
