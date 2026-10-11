'use client';

import { Fragment, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { createBrowserCommandClient } from '@/components/views/leads/client';
import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Surface } from '@/components/ui/surface';
import { SwipeRow } from '@/components/ui/swipe-row';
import { useToast } from '@/components/ui/toast';
import type { DashboardSnapshot } from '@/lib/dashboard';
import { humanError } from '@/components/ui/human-error';

type Task = DashboardSnapshot['leadTasks'][number];
type Section = 'today' | 'tomorrow' | 'followup';

function sectionOf(task: Task, today: string): Section {
  if (task.kind !== 'reminder' || !task.lessonDate) return 'followup';
  return task.lessonDate > today ? 'tomorrow' : 'today';
}
const RANK: Record<Section, number> = { today: 0, tomorrow: 1, followup: 2 };
const LABEL: Record<Section, string> = { today: 'Сьогодні', tomorrow: 'Завтра', followup: 'Повторні контакти' };

/** Прострочені ліди й нагадування: час (mono), ім'я, контекст; дії при hover або свайпом на телефоні. */
export function LeadQueue() {
  const { snapshot, user, openLead, navigate, refreshSnapshot } = useShell();
  const toast = useToast();
  const [command] = useState(() => createBrowserCommandClient(`${user.email}:today-reminders`));
  const [busyId, setBusyId] = useState<string | null>(null);

  const tasks = [...snapshot.leadTasks].sort((a, b) => RANK[sectionOf(a, snapshot.today)] - RANK[sectionOf(b, snapshot.today)] || a.dueAt - b.dueAt || a.leadId.localeCompare(b.leadId));

  const copy = async (task: Task) => {
    if (!task.reminderText) return;
    try {
      await navigator.clipboard.writeText(task.reminderText);
      toast.push({ message: 'Текст нагадування скопійовано.' });
    } catch {
      toast.push({ message: 'Не вдалося скопіювати текст.', tone: 'hot' });
    }
  };

  const markSent = async (task: Task) => {
    if (!task.reminderId || task.leadVersion === null || busyId) return;
    setBusyId(task.reminderId);
    try {
      await command('reminder_mark', { state: 'sent' }, { id: task.leadId, version: task.leadVersion }, task.reminderId);
      toast.push({ message: 'Нагадування позначено як надіслане.' });
      refreshSnapshot();
    } catch (reason) {
      toast.push({ message: humanError(reason, 'Не вдалося оновити нагадування.'), tone: 'hot' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Surface variant="glass" radius="card" data-reveal className="flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="queue-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="queue-title" className="m-0 text-[17px] font-medium">Прострочені ліди й нагадування</h2>
        <span className="font-mono text-sm text-ink-2">{snapshot.leadTaskCount}</span>
      </div>
      {tasks.length ? (
        <ol className="m-0 flex list-none flex-col p-0">
          {tasks.map((task, index) => {
            const section = sectionOf(task, snapshot.today);
            const previous = index > 0 ? sectionOf(tasks[index - 1], snapshot.today) : null;
            const key = `${task.kind}:${task.leadId}:${task.lessonId || task.dueAt}`;
            const overdue = task.kind === 'follow_up';
            const canMark = task.kind === 'reminder' && Boolean(task.reminderText);
            return (
              <Fragment key={key}>
                {section !== previous ? <li aria-hidden="true" className="mt-3 border-t border-line pb-1 pt-3 text-xs text-ink-2 first:mt-0 first:border-0 first:pt-0">{LABEL[section]}</li> : null}
                <li>
                  <SwipeRow right={canMark ? { label: 'Надіслано', run: () => void markSent(task) } : undefined} left={{ label: 'Відкрити', run: () => openLead(task.leadId) }}>
                    <div className="group/row flex items-center gap-3 rounded-inner px-2 py-2.5 transition-colors hover:bg-raised">
                      <span className="flex w-[84px] shrink-0 items-center gap-2 font-mono text-xs text-ink-2">
                        {overdue ? <i aria-label="Прострочено" className="size-1.5 shrink-0 rounded-full bg-hot" /> : <i aria-hidden="true" className="size-1.5 shrink-0" />}
                        {formatTaskTime(task.dueAt)}
                      </span>
                      <button type="button" onClick={() => openLead(task.leadId)} className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-sm font-medium">{task.leadName}</span>
                        <span className="block truncate text-xs text-ink-2">{task.title}</span>
                      </button>
                      <span className="hidden shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 md:flex">
                        {canMark ? (
                          <>
                            <Button variant="icon" size="sm" aria-label="Копіювати нагадування" onClick={() => void copy(task)}><Copy aria-hidden="true" strokeWidth={1.5} /></Button>
                            <Button variant="outline" size="sm" busy={busyId === task.reminderId} onClick={() => void markSent(task)}><Check aria-hidden="true" strokeWidth={1.5} />Надіслано</Button>
                          </>
                        ) : null}
                        <Button variant="icon" size="sm" aria-label="Відкрити ліда" onClick={() => openLead(task.leadId)}><ExternalLink aria-hidden="true" strokeWidth={1.5} /></Button>
                      </span>
                    </div>
                  </SwipeRow>
                </li>
              </Fragment>
            );
          })}
        </ol>
      ) : (
        <EmptyState text="Прострочених повторних контактів і активних нагадувань немає." action={<Button variant="outline" size="sm" onClick={() => navigate('leads')}>Відкрити лідів</Button>} />
      )}
    </Surface>
  );
}

function formatTaskTime(epoch: number) {
  return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(epoch * 1000));
}
