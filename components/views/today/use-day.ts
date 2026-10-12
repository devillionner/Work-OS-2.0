'use client';

import { CalendarCheck, MessagesSquare, Reply, Send, type LucideIcon } from 'lucide-react';
import { emitCommand } from '@/components/shell/command-bus';
import { useShell } from '@/components/shell/shell-context';
import type { RingTone } from '@/components/ui/ring';
import { useToast } from '@/components/ui/toast';
import { useTelegramAccounts } from '@/components/views/platforms/telegram-accounts';
import { telegramSchedule, useTelegramSchedule } from '@/components/views/platforms/telegram-schedule-store';
import { dayProgress, goalRatio } from '@/components/views/shared/pace';
import { buildDayModel, type DayEvent, type DayModel } from '@/components/views/today/day-model';
import type { Metric } from '@/components/views/today/kpi-panel';
import { useCheckpoints } from '@/components/views/today/use-checkpoints';
import { useMinuteClock } from '@/components/views/today/use-minute-clock';
import { useReminderActions } from '@/components/views/today/use-reminder-actions';
import { useReportStatuses } from '@/components/views/today/report-statuses';
import { isMissed, nextPending, slotTime } from '@/components/views/today/schedule-slots';
import { useWorkday, type WorkdayState } from '@/components/views/today/use-workday';

export type Goal = { metric: Metric; label: string; value: number; target: number; icon: LucideIcon; title: string; tone: RingTone; open: () => void };
export type StatusTone = 'ok' | 'hot' | 'neutral';
export type Status = { key: string; label: string; value: string; tone: StatusTone; link: boolean; loading: boolean; title: string; open: () => void };
export type EventAction = { label: string; round: boolean; busy: boolean; run: () => void };

export type Day = {
  now: number;
  model: DayModel;
  workday: WorkdayState;
  goals: Goal[];
  statuses: Status[];
  yesterdayPending: boolean;
  yesterdayDate: string;
  openYesterday: () => void;
  openEvent: (event: DayEvent) => void;
  actionOf: (event: DayEvent) => EventAction | null;
};

/** Тон кільця цілі: виконано — ok, у темпі — біле, трохи відстає — warn, відстає сильно — hot. До старту дня — нейтральне. */
function ringTone(value: number, target: number, started: boolean, now: number): RingTone {
  const ratio = goalRatio(value, target);
  if (target <= 0) return 'ink';
  if (ratio >= 1) return 'ok';
  if (!started) return 'ink';
  const expected = Math.max(0.02, dayProgress(new Date(now * 1000)));
  return ratio >= expected * 0.85 ? 'ink' : ratio >= expected * 0.6 ? 'warn' : 'hot';
}

/**
 * Усі дані екрана «Сьогодні» з наявних джерел, без нових періодичних запитів: знімок дашборда (цілі, нагадування, стан дня),
 * стор розкладу Telegram, проміжні звіти й статуси звітів (по одному запиту при відкритті). Лінія «зараз» і відносний час
 * оновлюються щохвилини локально.
 */
export function useDay(): Day {
  const { snapshot, navigate, openLead } = useShell();
  const toast = useToast();
  const now = useMinuteClock();
  const workday = useWorkday();
  const reminders = useReminderActions();
  const checkpoints = useCheckpoints();
  const reports = useReportStatuses();
  const telegram = snapshot.enabledPlatforms.includes('telegram');
  const { accounts, accountId } = useTelegramAccounts(telegram);
  const { snapshot: schedule, loading: scheduleLoading, busy: scheduleBusy } = useTelegramSchedule(telegram ? accountId : null);
  const slots = schedule?.slots ?? [];
  const accountLabel = accounts.find((account) => account.id === accountId)?.name ?? 'Telegram';

  const model = buildDayModel({ now, today: snapshot.today, workday: workday.workday, tasks: reminders.tasks, slots, accountLabel, checkpoints: checkpoints.items });

  const go = (view: 'platforms' | 'leads', queue?: { platform: string; queue: string }) => () => { navigate(view); if (queue) emitCommand('platforms:queue', queue); };
  const totals = snapshot.platforms.reduce(
    (sum, platform) => ({ publications: sum.publications + platform.publications, joined: sum.joined + platform.joined, responses: sum.responses + platform.responses, bookings: sum.bookings + platform.bookings }),
    { publications: 0, joined: 0, responses: 0, bookings: 0 },
  );
  const started = workday.workday !== null && workday.workday.workDate === snapshot.today;
  const goals: Goal[] = [
    { metric: 'publications', label: 'Публікації', value: totals.publications, target: snapshot.publicationGoal.target, icon: Send, title: 'Відкрити «Для публікації»', tone: ringTone(totals.publications, snapshot.publicationGoal.target, started, now), open: go('platforms', { platform: 'telegram', queue: 'ready' }) },
    { metric: 'joined', label: 'Нові чати', value: totals.joined, target: snapshot.chatGoal.target, icon: MessagesSquare, title: 'Відкрити чергу приєднання', tone: ringTone(totals.joined, snapshot.chatGoal.target, started, now), open: go('platforms', { platform: 'telegram', queue: 'to_join' }) },
    { metric: 'responses', label: 'Відгуки', value: totals.responses, target: snapshot.responseGoal.target, icon: Reply, title: 'Відкрити ліди', tone: ringTone(totals.responses, snapshot.responseGoal.target, started, now), open: go('leads') },
    { metric: 'bookings', label: 'Записи', value: totals.bookings, target: snapshot.bookingGoal.target, icon: CalendarCheck, title: 'Відкрити ліди', tone: ringTone(totals.bookings, snapshot.bookingGoal.target, started, now), open: go('leads') },
  ];

  const openReport = (date: string) => () => { navigate('reports'); emitCommand('reports:date', date); };
  const openSchedule = () => { navigate('platforms'); emitCommand('platforms:telegram-schedule'); };
  const nextSlot = nextPending(slots, now);
  const missed = slots.filter((slot) => isMissed(slot, now)).length;
  const yesterday = reports.yesterday;
  const today = reports.today;
  const statuses: Status[] = [
    { key: 'yesterday', label: 'Звіт за вчора', value: yesterday === 'submitted' ? 'здано' : yesterday === 'pending' ? 'не здано' : 'не потрібен', tone: yesterday === 'submitted' ? 'ok' : yesterday === 'pending' ? 'hot' : 'neutral', link: yesterday === 'pending', loading: reports.loading && yesterday === null, title: 'Відкрити звіт за вчора', open: openReport(reports.yesterdayDate) },
    { key: 'today', label: 'Звіт сьогодні', value: today === 'submitted' ? 'здано' : today === 'draft' ? 'чернетка' : 'не почато', tone: today === 'submitted' ? 'ok' : 'neutral', link: false, loading: today === null && reports.loading, title: 'Відкрити звіт дня', open: openReport(snapshot.today) },
  ];
  if (telegram) {
    statuses.push({
      key: 'schedule',
      label: 'Розклад',
      value: nextSlot ? `наступний слот ${slotTime(nextSlot.scheduledAt)} · ${nextSlot.chatName ?? 'чат'}` : !slots.length ? 'на сьогодні не створено' : missed ? `пропущено ${missed}` : 'усі слоти виконано',
      tone: nextSlot || (slots.length > 0 && !missed) ? 'ok' : 'neutral',
      link: false,
      loading: !schedule && scheduleLoading,
      title: 'Відкрити розклад Telegram',
      open: openSchedule,
    });
  }

  const openEvent = (event: DayEvent) => {
    if (event.task) openLead(event.task.leadId);
    else if (event.kind === 'slot') openSchedule();
    else if (event.kind === 'checkpoint') openReport(snapshot.today)();
  };

  const actionOf = (event: DayEvent): EventAction | null => {
    if (event.kind === 'reminder' && event.task) {
      const task = event.task;
      if (task.kind === 'follow_up' || task.reminderText) return { label: 'Готово', round: false, busy: false, run: () => reminders.done(task) };
      return { label: 'Уточнити', round: false, busy: false, run: () => openLead(task.leadId) };
    }
    if (event.kind === 'slot' && event.slot && accountId && event.slot.chatId && event.slot.chatStateToken && event.slot.status === 'pending' && (event.attention || event.next || event.state === 'missed')) {
      const slot = event.slot;
      return {
        label: 'Опубліковано',
        round: true,
        busy: scheduleBusy,
        run: () => { void telegramSchedule.markPublished(accountId, slot).then((ok) => { if (ok) toast.push({ message: `Публікацію в «${slot.chatName || 'чаті'}» відмічено.` }); }); },
      };
    }
    if (event.kind === 'checkpoint' && event.checkpoint && (event.state === 'due' || event.state === 'late')) {
      const item = event.checkpoint;
      return { label: 'Здати', round: false, busy: checkpoints.saving === item.slot, run: () => void checkpoints.submit(item) };
    }
    return null;
  };

  return { now, model, workday, goals, statuses, yesterdayPending: yesterday === 'pending', yesterdayDate: reports.yesterdayDate, openYesterday: openReport(reports.yesterdayDate), openEvent, actionOf };
}
