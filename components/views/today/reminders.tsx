'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock3, Ellipsis, ExternalLink } from 'lucide-react';
import { emitCommand } from '@/components/shell/command-bus';
import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { humanError } from '@/components/ui/human-error';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast';
import { createBrowserCommandClient, getJson } from '@/components/views/leads/client';
import { shiftDay } from '@/components/views/reports/types';
import { useMinuteClock } from '@/components/views/today/use-minute-clock';
import type { DashboardSnapshot } from '@/lib/dashboard';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { businessDateTime, lessonEpoch } from '@/lib/leads/domain/time';
import { cn } from '@/lib/utils';

type Task = DashboardSnapshot['leadTasks'][number];

/** Скільки секунд «Готово» можна скасувати: дія на сервері йде лише після цього часу. */
const UNDO_MS = 8000;
const VISIBLE = 3;

const taskKey = (task: Task) => `${task.kind}:${task.leadId}:${task.reminderId ?? task.dueAt}`;
const clock = (epoch: number) => businessDateTime(epoch).slice(11, 16);
const dayOf = (epoch: number) => businessDateTime(epoch).slice(0, 10);
const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

function span(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} хв`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} год ${minutes % 60} хв` : `${hours} год`;
  return `${Math.floor(hours / 24)} дн`;
}

/** Нагадування уроку: у заголовку завдання «Нагадати про урок: предмет · учень». */
function parseReminder(title: string): { action: string; subject: string } | null {
  const match = /^(Нагадати про урок|Уточнити дані уроку): (.+?) · (.+)$/.exec(title);
  return match ? { action: match[1].toLowerCase(), subject: match[2] } : null;
}

/**
 * «Нагадування» у правій половині картки дня: до трьох рядків — прострочені першими (червона крапка), далі сьогоднішні за часом.
 * «Готово» — наявна дія з черги лідів (нагадування → «надіслано», повторний контакт → прибрати дату контакту) із Toast і скасуванням
 * 8 с: рядок зникає одразу, а запит іде після 8 с, якщо не скасовано (API не вміє «розмітити» надіслане). «Відкласти» — лише для
 * повторних контактів (оновлення дати контакту); у нагадувань уроку такої дії в API немає.
 */
export function Reminders() {
  const { snapshot, user, openLead, navigate, refreshSnapshot } = useShell();
  const toast = useToast();
  const now = useMinuteClock();
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

  const schedule = (task: Task, message: string, run: () => Promise<void>) => {
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

  const detailVersion = async (task: Task) => (await getJson<LeadDetail>(`/api/leads?id=${encodeURIComponent(task.leadId)}`)).lead.version;

  const done = (task: Task) => {
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

  const postpone = (task: Task) => {
    const target = lessonEpoch(shiftDay(snapshot.today, 1), '10:00');
    if (target === null) return;
    schedule(task, 'Контакт відкладено на завтра, 10:00.', async () => {
      await command('update', { nextContactAt: target }, { id: task.leadId, version: await detailVersion(task) });
    });
  };

  const visibleTasks = snapshot.leadTasks.filter((task) => !hidden.has(taskKey(task)));
  const overdue = visibleTasks.filter((task) => task.dueAt < now).sort((a, b) => a.dueAt - b.dueAt);
  const today = visibleTasks.filter((task) => task.dueAt >= now && dayOf(task.dueAt) === snapshot.today).sort((a, b) => a.dueAt - b.dueAt);
  const later = visibleTasks.filter((task) => task.dueAt >= now && dayOf(task.dueAt) !== snapshot.today).sort((a, b) => a.dueAt - b.dueAt);
  const rows = [...overdue, ...today].slice(0, VISIBLE);
  const upcoming = later[0];
  const total = overdue.length + today.length + later.length;

  const openAll = () => { navigate('leads'); emitCommand('leads:filter', overdue.length ? 'overdue' : 'active'); };

  return (
    <section aria-labelledby="reminders-title" className="@container flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 id="reminders-title" className="m-0 text-[17px] font-medium">Нагадування</h3>
        {total > 0 ? <Button variant="ghost" size="sm" title="Відкрити ліди з фільтром «Прострочені»" onClick={openAll}>Усі · {total}</Button> : null}
      </div>
      {rows.length ? (
        <ol className="m-0 flex list-none flex-col p-0">
          {rows.map((task) => {
            const late = task.dueAt < now;
            const parsed = task.kind === 'reminder' ? parseReminder(task.title) : null;
            const when = late ? `прострочено ${span(now - task.dueAt)}` : `через ${span(task.dueAt - now)}`;
            const essence = task.kind === 'follow_up' ? `повторний контакт · ${when}` : `${parsed?.action ?? 'нагадування'} · ${when}`;
            const stamp = dayOf(task.dueAt) === snapshot.today ? clock(task.dueAt) : `${shortDay(dayOf(task.dueAt))} ${clock(task.dueAt)}`;
            const canFinish = task.kind === 'follow_up' || Boolean(task.reminderText);
            return (
              <li key={taskKey(task)} className="flex min-h-14 items-center gap-2 border-t border-line first:border-t-0">
                <button type="button" title={task.title} onClick={() => openLead(task.leadId)} className="flex min-w-0 flex-1 items-center gap-3 rounded-inner py-2 text-left transition-colors hover:bg-raised">
                  <i aria-label={late ? 'Прострочено' : undefined} aria-hidden={late ? undefined : true} className={cn('size-1.5 shrink-0 rounded-full', late ? 'bg-hot' : 'bg-ink-3')} />
                  <span className="hidden w-12 shrink-0 font-mono text-xs tabular-nums text-ink-2 @md:block">{stamp}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{task.leadName}{parsed ? ` · ${parsed.subject}` : ''}</span>
                    <span className="block text-xs text-ink-2 @max-md:line-clamp-2 @md:truncate"><span className="font-mono tabular-nums @md:hidden">{stamp} · </span>{essence}</span>
                  </span>
                </button>
                {canFinish ? <Button variant="outline" size="sm" onClick={() => done(task)} className="shrink-0">Готово</Button> : <Button variant="outline" size="sm" onClick={() => openLead(task.leadId)} className="shrink-0">Уточнити</Button>}
                {task.kind === 'follow_up' ? (
                  <Menu>
                    <MenuTrigger render={<Button variant="icon" size="sm" aria-label={`Ще дії: ${task.leadName}`} className="shrink-0" />}><Ellipsis aria-hidden="true" strokeWidth={1.5} /></MenuTrigger>
                    <MenuContent align="end">
                      <MenuItem onClick={() => postpone(task)}><Clock3 aria-hidden="true" strokeWidth={1.5} />Відкласти на завтра</MenuItem>
                      <MenuItem onClick={() => openLead(task.leadId)}><ExternalLink aria-hidden="true" strokeWidth={1.5} />Відкрити ліда</MenuItem>
                    </MenuContent>
                  </Menu>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="flex flex-col gap-1 py-1">
          <p className="m-0 text-sm text-ink-2">Нагадувань на зараз немає</p>
          {upcoming ? <p className="m-0 text-xs text-ink-2">Наступне: {dayOf(upcoming.dueAt) === shiftDay(snapshot.today, 1) ? 'завтра' : shortDay(dayOf(upcoming.dueAt))} {clock(upcoming.dueAt)} · {upcoming.leadName}</p> : null}
        </div>
      )}
    </section>
  );
}
