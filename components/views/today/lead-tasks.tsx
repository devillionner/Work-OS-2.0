'use client';

import { Fragment, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { createBrowserCommandClient } from '@/components/views/leads/client';
import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { humanError } from '@/components/ui/human-error';
import { SwipeRow } from '@/components/ui/swipe-row';
import { useToast } from '@/components/ui/toast';
import type { DashboardSnapshot } from '@/lib/dashboard';

type Task = DashboardSnapshot['leadTasks'][number];
type Section = 'today' | 'tomorrow' | 'followup';

function sectionOf(task: Task, today: string): Section {
  if (task.kind !== 'reminder' || !task.lessonDate) return 'followup';
  return task.lessonDate > today ? 'tomorrow' : 'today';
}
const RANK: Record<Section, number> = { today: 0, tomorrow: 1, followup: 2 };
const LABEL: Record<Section, string> = { today: 'Сьогодні', tomorrow: 'Завтра', followup: 'Повторні контакти' };
/** Скільки рядків видно одразу; решта — у «Ліди». */
const VISIBLE = 4;

/** Прострочені ліди й нагадування: час (mono), ім'я, контекст; дії при hover або свайпом на телефоні. */
export function LeadTasks() {
  const { snapshot, user, openLead, navigate, refreshSnapshot } = useShell();
  const toast = useToast();
  const [command] = useState(() => createBrowserCommandClient(`${user.email}:today-reminders`));
  const [busyId, setBusyId] = useState<string | null>(null);

  const tasks = [...snapshot.leadTasks].sort((a, b) => RANK[sectionOf(a, snapshot.today)] - RANK[sectionOf(b, snapshot.today)] || a.dueAt - b.dueAt || a.leadId.localeCompare(b.leadId));
  const shown = tasks.slice(0, VISIBLE);

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
    <div className="flex flex-col gap-1 pb-2">
      <p className="m-0 flex items-baseline justify-between gap-3 pt-2 text-xs text-ink-2"><span>Прострочені ліди й нагадування</span><span className="font-mono tabular-nums">{snapshot.leadTaskCount}</span></p>
      <ol className="m-0 flex list-none flex-col p-0">
        {shown.map((task, index) => {
          const section = sectionOf(task, snapshot.today);
          const previous = index > 0 ? sectionOf(shown[index - 1], snapshot.today) : null;
          const key = `${task.kind}:${task.leadId}:${task.lessonId || task.dueAt}`;
          const overdue = task.kind === 'follow_up';
          const canMark = task.kind === 'reminder' && Boolean(task.reminderText);
          return (
            <Fragment key={key}>
              {section !== previous && (previous !== null || section !== 'followup') ? <li aria-hidden="true" className="px-2 pb-0.5 pt-2 text-[11px] text-ink-3">{LABEL[section]}</li> : null}
              <li>
                <SwipeRow right={canMark ? { label: 'Надіслано', run: () => void markSent(task) } : undefined} left={{ label: 'Відкрити', run: () => openLead(task.leadId) }}>
                  <div className="group/row flex min-h-11 items-center gap-3 rounded-inner px-2 py-1.5 transition-colors hover:bg-raised">
                    <span className="flex w-[7.75rem] shrink-0 items-center gap-2 whitespace-nowrap font-mono text-xs tabular-nums text-ink-2">
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
      {tasks.length > VISIBLE || snapshot.leadTaskCount > tasks.length ? <Button variant="ghost" size="sm" className="self-start" onClick={() => navigate('leads')}>Усі {snapshot.leadTaskCount} у «Ліди»</Button> : null}
    </div>
  );
}

function formatTaskTime(epoch: number) {
  return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(epoch * 1000));
}
