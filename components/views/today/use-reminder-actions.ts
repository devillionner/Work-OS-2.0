'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useShell } from '@/components/shell/shell-context';
import { humanError } from '@/components/ui/human-error';
import { useToast } from '@/components/ui/toast';
import { createBrowserCommandClient, getJson } from '@/components/views/leads/client';
import { taskKey, type LeadTask } from '@/components/views/today/day-model';
import { announceDataChange } from '@/lib/client-sync';
import type { LeadDetail } from '@/lib/leads/application/queries';

/** Скільки мілісекунд «Готово» можна скасувати: дія на сервері йде лише після цього часу. */
const UNDO_MS = 8000;

type Command = ReturnType<typeof createBrowserCommandClient>;
type Toast = ReturnType<typeof useToast>;
type Entry = { timer: number; execute: () => Promise<void> };

/**
 * Одне джерело правди для нагадувань. «Готово» можна натиснути в шкалі й заголовку «Сьогодні» та у вкладці «Нагадування»
 * ліда; усі три місця читають і змінюють ту саму множину прихованих ключів (`taskKey`), тож нагадування зникає й
 * повертається в усіх одразу, також під час 8 с на «Скасувати». Стан живе на рівні модуля (а не в компоненті), тому
 * відкриття й закриття екранів його не губить; відкладена дія виконується одразу лише коли вкладку згортають чи закривають.
 */
const pending = new Map<string, Entry>();
const listeners = new Set<() => void>();
let hidden: ReadonlySet<string> = new Set();
let queue: Promise<void> = Promise.resolve();
let command: { email: string; run: Command } | null = null;
const context: { refresh: () => void; toast: Toast | null } = { refresh: () => {}, toast: null };

const EMPTY: ReadonlySet<string> = new Set();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getHidden = () => hidden;
const getServerHidden = () => EMPTY;

function setHidden(next: ReadonlySet<string>) {
  hidden = next;
  for (const listener of listeners) listener();
}
const hide = (id: string) => setHidden(new Set(hidden).add(id));
function unhide(id: string) {
  const next = new Set(hidden);
  next.delete(id);
  setHidden(next);
}

function flushAll() {
  for (const entry of pending.values()) void entry.execute();
}
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
  window.addEventListener('pagehide', flushAll);
}

function schedule(id: string, message: string, run: () => Promise<void>) {
  if (pending.has(id)) return;
  hide(id);
  const execute = () => {
    const entry = pending.get(id);
    if (!entry) return Promise.resolve();
    window.clearTimeout(entry.timer);
    pending.delete(id);
    // Дії йдуть по черзі: клієнт команд не вміє дві одночасно.
    queue = queue.then(async () => {
      try { await run(); context.refresh(); announceDataChange('leads'); }
      catch (reason) { unhide(id); context.toast?.push({ message: humanError(reason, 'Не вдалося виконати дію.'), tone: 'hot' }); }
    });
    return queue;
  };
  const timer = window.setTimeout(() => void execute(), UNDO_MS);
  pending.set(id, { timer, execute });
  context.toast?.push({ message, duration: UNDO_MS, action: { label: 'Скасувати', onClick: () => undo(id) } });
}

/** «Скасувати»: нагадування повертається в усі місця, запит на сервер так і не йде. */
function undo(id: string) {
  const entry = pending.get(id);
  if (!entry) return;
  window.clearTimeout(entry.timer);
  pending.delete(id);
  unhide(id);
}

/** Ключ нагадування уроку збігається з `taskKey` задачі зі знімка «Сьогодні». */
export const reminderKey = (leadId: string, reminderId: string) => `reminder:${leadId}:${reminderId}`;

const detailVersion = async (leadId: string) => (await getJson<LeadDetail>(`/api/leads?id=${encodeURIComponent(leadId)}`)).lead.version;

/**
 * Дії над нагадуваннями з черги лідів. «Готово»: нагадування уроку → `reminder_mark sent`, повторний контакт → прибрати дату
 * контакту. Рядок зникає одразу всюди, Toast дає 8 с на «Скасувати», а запит іде лише після цього часу (API не вміє
 * «розмітити» надіслане).
 */
export function useReminderActions() {
  const { snapshot, user, refreshSnapshot } = useShell();
  const toast = useToast();
  const hiddenKeys = useSyncExternalStore(subscribe, getHidden, getServerHidden);
  useEffect(() => {
    context.refresh = refreshSnapshot;
    context.toast = toast;
  });
  const commandClient = () => {
    if (!command || command.email !== user.email) command = { email: user.email, run: createBrowserCommandClient(`${user.email}:today-reminders`) };
    return command.run;
  };

  const markSent = (target: { leadId: string; reminderId: string; leadVersion: number | null }) => {
    schedule(reminderKey(target.leadId, target.reminderId), 'Нагадування позначено як надіслане.', async () => {
      if (target.leadVersion === null) throw new Error('Не вдалося оновити нагадування.');
      await commandClient()('reminder_mark', { state: 'sent' }, { id: target.leadId, version: target.leadVersion }, target.reminderId);
    });
  };

  const done = (task: LeadTask) => {
    if (task.kind === 'reminder') {
      if (!task.reminderId) return;
      markSent({ leadId: task.leadId, reminderId: task.reminderId, leadVersion: task.leadVersion });
      return;
    }
    schedule(taskKey(task), 'Контакт позначено виконаним.', async () => {
      await commandClient()('update', { nextContactAt: null }, { id: task.leadId, version: await detailVersion(task.leadId) });
    });
  };

  return {
    tasks: snapshot.leadTasks.filter((task) => !hiddenKeys.has(taskKey(task))),
    done,
    markSent,
    undo,
    /** Нагадування вже позначено, але ще можна скасувати (ті самі 8 с, що й у «Сьогодні»). */
    isPending: (leadId: string, reminderId: string) => hiddenKeys.has(reminderKey(leadId, reminderId)),
  };
}
