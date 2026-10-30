import type { ScheduleSlot } from '@/components/views/platforms/telegram-schedule-store';
import { isMissed, MISSED_AFTER_SECONDS, nextPending } from '@/components/views/today/schedule-slots';
import type { DashboardSnapshot } from '@/lib/dashboard';
import { businessDate, businessDateTime, lessonEpoch } from '@/lib/leads/domain/time';
import type { WorkdaySnapshot } from '@/lib/workday';

export type LeadTask = DashboardSnapshot['leadTasks'][number];
export type CheckpointSlot = '13:00' | '16:00' | '19:00';
export type Checkpoint = { slot: CheckpointSlot; state: 'skipped' | 'upcoming' | 'due' | 'submitted'; reason: string | null; submittedAt: number | null; text: string | null; version: number };

export type EventKind = 'slot' | 'reminder' | 'checkpoint' | 'start' | 'pause' | 'end';
/** done — виконано; missed — слот пропущено; due — час настав; overdue/late — прострочено; pending — попереду. */
export type EventState = 'done' | 'missed' | 'due' | 'overdue' | 'late' | 'pending';

export type DayEvent = {
  id: string;
  kind: EventKind;
  /** Епоха, секунди. */
  at: number;
  state: EventState;
  title: string;
  sub: string;
  slot?: ScheduleSlot;
  task?: LeadTask;
  checkpoint?: Checkpoint;
  /** Найближчий слот розкладу. */
  next: boolean;
  /** Потребує уваги: прострочене нагадування, слот, що настав, звіт, який пора здати. Пропущений слот лише позначений, але дію зберігає. */
  attention: boolean;
  /** Минуле, яке лише для довідки: початок дня, пауза, виконане. */
  dim: boolean;
};

export type Segment = { from: number; to: number; kind: 'work' | 'pause' };

export type DayModel = {
  /** Події сьогодні, за часом. */
  events: DayEvent[];
  /** Прострочені нагадування за попередні дні. */
  carry: DayEvent[];
  /** Нагадування на завтра й пізніше. */
  tomorrow: DayEvent[];
  /** Усе, що потребує уваги: carry і сьогоднішні, за часом. */
  attention: DayEvent[];
  /** Найближча подія попереду (слот із чатом, нагадування, звіт) або перше нагадування на завтра. */
  upcoming: DayEvent | null;
  /** Епоха 00:00 за Києвом. */
  dayStart: number;
  /** Межі шкали, хвилини від 00:00 (кратні годині). */
  range: { from: number; to: number };
  /** Сегменти роботи й поточної паузи, хвилини від 00:00 (кінець — з дробовою частиною). */
  segments: Segment[];
  /** Скільки хвилин пауз було раніше (історії пауз немає, відомий лише підсумок). */
  earlierPauseMinutes: number;
  /** Хвилини від 00:00 для «зараз» (з дробовою частиною). */
  nowMinutes: number;
};

const KIND_ORDER: Record<EventKind, number> = { start: 0, pause: 0, end: 0, slot: 1, reminder: 2, checkpoint: 3 };
const LATE_AFTER_SECONDS = 20 * 60;
const DEFAULT_FROM = 8 * 60;
const DEFAULT_TO = 21 * 60;

/** «5 хв», «1 год 5 хв», «2 дн». */
export function span(minutes: number): string {
  const total = Math.max(1, Math.round(minutes));
  if (total < 60) return `${total} хв`;
  const hours = Math.floor(total / 60);
  if (hours < 24) return total % 60 ? `${hours} год ${total % 60} хв` : `${hours} год`;
  return `${Math.floor(hours / 24)} дн`;
}

/** «через 15 хв», «прострочено 40 хв», «зараз» — з точністю до хвилини. */
export function relative(at: number, now: number): string {
  const diff = Math.floor(at / 60) - Math.floor(now / 60);
  if (diff === 0) return 'зараз';
  return diff > 0 ? `через ${span(diff)}` : `прострочено ${span(-diff)}`;
}

export const clockOf = (epoch: number) => businessDateTime(epoch).slice(11, 16);
export const dayOf = (epoch: number) => businessDate(epoch);
export const shortDate = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
export const hourLabel = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** «Раніше були паузи» потрібне лише від хвилини. */
const MIN_EARLIER_PAUSE = 1;

/** Нагадування уроку: у заголовку завдання «Нагадати про урок: предмет · учень». */
function parseReminder(title: string): { action: string; subject: string } | null {
  const match = /^(Нагадати про урок|Уточнити дані уроку): (.+?) · (.+)$/.exec(title);
  return match ? { action: match[1].toLowerCase(), subject: match[2] } : null;
}

export function reminderTitle(task: LeadTask): string {
  const parsed = task.kind === 'reminder' ? parseReminder(task.title) : null;
  return `${task.leadName}${parsed ? ` · ${parsed.subject}` : ''}`;
}

export function taskKey(task: LeadTask): string {
  return `${task.kind}:${task.leadId}:${task.reminderId ?? task.dueAt}`;
}

export function durationLabel(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} хв`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} год ${minutes % 60} хв` : `${Math.floor(minutes / 60)} год`;
}

type Input = {
  now: number;
  today: string;
  workday: WorkdaySnapshot | null;
  tasks: readonly LeadTask[];
  slots: readonly ScheduleSlot[];
  accountLabel: string;
  checkpoints: readonly Checkpoint[] | null;
};

function sortEvents(list: DayEvent[]) {
  return list.sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/** Один список подій дня з наявних джерел: розклад Telegram, черга лідів, контрольні звіти й стан робочого дня. */
export function buildDayModel({ now, today, workday, tasks, slots, accountLabel, checkpoints }: Input): DayModel {
  const dayStart = lessonEpoch(today, '00:00') ?? Math.floor(now / 86400) * 86400;
  const minutes = (epoch: number) => (epoch - dayStart) / 60;
  const events: DayEvent[] = [];
  const carry: DayEvent[] = [];
  const tomorrow: DayEvent[] = [];

  const next = nextPending(slots, now);
  for (const slot of slots) {
    const free = slot.chatId === null;
    const done = slot.status === 'completed';
    const missed = isMissed(slot, now);
    const due = !done && !free && !missed && slot.scheduledAt <= now && now - slot.scheduledAt <= MISSED_AFTER_SECONDS;
    const state: EventState = done ? 'done' : missed ? 'missed' : due ? 'due' : 'pending';
    events.push({
      id: `slot:${slot.id}`,
      kind: 'slot',
      at: slot.scheduledAt,
      state,
      title: slot.chatName ? `«${slot.chatName}»` : (free ? 'Вільний слот' : 'Чат не призначено'),
      sub: done ? 'опубліковано' : missed ? 'пропущено' : `${accountLabel} · ${relative(slot.scheduledAt, now)}`,
      slot,
      next: next?.id === slot.id,
      attention: !done && !free && due,
      dim: done || missed,
    });
  }

  for (const task of tasks) {
    const parsed = task.kind === 'reminder' ? parseReminder(task.title) : null;
    const essence = task.kind === 'follow_up' ? 'повторний контакт' : task.kind === 'custom' ? task.title : (parsed?.action ?? 'нагадування');
    const late = task.dueAt < now;
    const event: DayEvent = {
      id: `task:${taskKey(task)}`,
      kind: 'reminder',
      at: task.dueAt,
      state: late ? 'overdue' : 'pending',
      title: reminderTitle(task),
      sub: `${essence} · ${relative(task.dueAt, now)}`,
      task,
      next: false,
      attention: late,
      dim: false,
    };
    if (task.dueAt < dayStart) carry.push(event);
    else if (dayOf(task.dueAt) !== today) tomorrow.push({ ...event, sub: `${essence} · ${shortDate(dayOf(task.dueAt))} ${clockOf(task.dueAt)}` });
    else events.push(event);
  }

  for (const item of checkpoints ?? []) {
    if (item.state === 'skipped') continue;
    const at = lessonEpoch(today, item.slot);
    if (at === null) continue;
    const late = item.state === 'due' && now - at > LATE_AFTER_SECONDS;
    const state: EventState = item.state === 'submitted' ? 'done' : late ? 'late' : item.state === 'due' ? 'due' : 'pending';
    events.push({
      id: `checkpoint:${item.slot}`,
      kind: 'checkpoint',
      at,
      state,
      title: `Проміжний звіт ${item.slot}`,
      sub: state === 'done' ? (item.submittedAt ? `здано ${clockOf(item.submittedAt)}` : 'здано') : state === 'late' ? `не здано · прострочено ${span((now - at) / 60)}` : state === 'due' ? 'пора здати' : relative(at, now),
      checkpoint: item,
      next: false,
      attention: state === 'due' || state === 'late',
      dim: state === 'done',
    });
  }

  const todayWorkday = workday && workday.workDate === today ? workday : null;
  const segments: Segment[] = [];
  let earlierPauseMinutes = 0;
  if (todayWorkday) {
    const endEpoch = todayWorkday.endedAt ?? now;
    const paused = todayWorkday.status === 'paused' && todayWorkday.pausedAt !== null;
    // Журнал пауз (міграція 0059): кожна пауза стоїть на своєму місці. Для днів до журналу паузи невідомі, тож лишається сума «пауз раніше».
    const journal = [...(todayWorkday.pauses ?? [])].sort((x, y) => x.startedAt - y.startedAt);
    const known = journal.reduce((sum, pause) => sum + Math.max(0, Math.min(pause.endedAt ?? endEpoch, endEpoch) - pause.startedAt), 0);
    const activeSeconds = todayWorkday.activeSeconds + (todayWorkday.status === 'active' ? Math.max(0, now - todayWorkday.asOf) : 0);
    const totalPause = Math.max(0, endEpoch - todayWorkday.startedAt - activeSeconds);
    const currentPause = paused ? Math.max(0, now - (todayWorkday.pausedAt as number)) : 0;
    const unexplained = journal.length ? Math.max(0, totalPause - known) : Math.max(0, totalPause - currentPause);
    const earlier = Math.floor(unexplained / 60);
    earlierPauseMinutes = earlier >= MIN_EARLIER_PAUSE ? earlier : 0;
    if (journal.length) {
      let cursor = todayWorkday.startedAt;
      for (const pause of journal) {
        const end = Math.min(pause.endedAt ?? endEpoch, endEpoch);
        if (pause.startedAt > cursor) segments.push({ from: minutes(cursor), to: minutes(pause.startedAt), kind: 'work' });
        if (end > pause.startedAt) segments.push({ from: minutes(pause.startedAt), to: minutes(end), kind: 'pause' });
        cursor = Math.max(cursor, end);
      }
      if (endEpoch > cursor) segments.push({ from: minutes(cursor), to: minutes(endEpoch), kind: 'work' });
    } else if (paused) {
      segments.push({ from: minutes(todayWorkday.startedAt), to: minutes(todayWorkday.pausedAt as number), kind: 'work' });
      segments.push({ from: minutes(todayWorkday.pausedAt as number), to: minutes(endEpoch), kind: 'pause' });
    } else {
      segments.push({ from: minutes(todayWorkday.startedAt), to: minutes(endEpoch), kind: 'work' });
    }
    events.push({ id: 'workday:start', kind: 'start', at: todayWorkday.startedAt, state: 'done', title: 'Початок дня', sub: 'відлік активного часу', next: false, attention: false, dim: true });
    if (journal.length) {
      for (const pause of journal) {
        const length = Math.max(0, (pause.endedAt ?? endEpoch) - pause.startedAt);
        events.push({ id: `workday:pause:${pause.startedAt}`, kind: 'pause', at: pause.startedAt, state: 'done', title: 'Пауза', sub: pause.endedAt === null && paused ? `триває ${span(length / 60)}` : span(length / 60), next: false, attention: false, dim: true });
      }
    } else if (paused) events.push({ id: 'workday:pause', kind: 'pause', at: todayWorkday.pausedAt as number, state: 'done', title: 'Пауза', sub: `триває ${span(currentPause / 60)}`, next: false, attention: false, dim: true });
    if (todayWorkday.endedAt !== null) events.push({ id: 'workday:end', kind: 'end', at: todayWorkday.endedAt, state: 'done', title: 'Кінець дня', sub: `відпрацьовано ${durationLabel(todayWorkday.activeSeconds)}`, next: false, attention: false, dim: true });
  }

  sortEvents(events);
  sortEvents(carry);
  sortEvents(tomorrow);
  const attention = [...carry, ...events.filter((event) => event.attention)];
  const upcoming = events.find((event) => event.state === 'pending' && event.at >= now && (event.kind === 'reminder' || event.kind === 'checkpoint' || (event.kind === 'slot' && event.slot?.chatId))) ?? tomorrow[0] ?? null;

  const marks = [minutes(now), ...events.map((event) => minutes(event.at))];
  const from = Math.max(0, Math.min(DEFAULT_FROM, Math.floor(Math.min(...marks) / 60) * 60));
  const to = Math.min(24 * 60, Math.max(DEFAULT_TO, Math.ceil(Math.max(...marks) / 60) * 60));

  return { events, carry, tomorrow, attention, upcoming, dayStart, range: { from, to }, segments, earlierPauseMinutes, nowMinutes: minutes(now) };
}

export type Placed = { key: string; minutes: number; height: number; offset: number };

/**
 * Розкладка за часом без накладань: майбутнє росте вниз від лінії «зараз», минуле — угору. Подія, що припадає на ту саму
 * хвилину, зсувається, а не накладається. `y(m)` — позиція хвилини на осі, `yNow` — позиція лінії «зараз».
 */
export function layoutY(items: readonly Placed[], y: (minutes: number) => number, yNow: number, nowMinutes: number, gap: number): Map<string, number> {
  const positions = new Map<string, number>();
  const future = items.filter((item) => item.minutes >= nowMinutes).sort((a, b) => a.minutes - b.minutes);
  const past = items.filter((item) => item.minutes < nowMinutes).sort((a, b) => b.minutes - a.minutes);
  let bottom = yNow + 4 - gap;
  for (const item of future) {
    const top = Math.max(y(item.minutes) - item.offset, bottom + gap);
    positions.set(item.key, top);
    bottom = top + item.height;
  }
  let top = yNow - 4 + gap;
  for (const item of past) {
    const next = Math.min(y(item.minutes) - item.offset, top - gap - item.height);
    positions.set(item.key, next);
    top = next;
  }
  return positions;
}

export type Headline = { when: string; what: string; hint: string; event: DayEvent | null };

/** Заголовок-відлік шкали: «Через 15 хв — слот «…»» і підказка про наступну подію. */
export function describeUpcoming(model: DayModel, now: number, started: boolean): Headline {
  const list = [...model.events.filter((event) => event.state === 'pending' && event.at >= now && (event.kind === 'reminder' || event.kind === 'checkpoint' || (event.kind === 'slot' && event.slot?.chatId))), ...model.tomorrow];
  const first = list[0] ?? null;
  const prefix = started ? '' : 'День ще не розпочато. ';
  if (!first) {
    return { when: 'На сьогодні', what: 'подій більше немає', hint: model.attention.length ? `Лишилося справ: ${model.attention.length}` : 'Усе заплановане виконано', event: null };
  }
  const tomorrowEvent = model.tomorrow.includes(first);
  const when = tomorrowEvent ? `Завтра о ${clockOf(first.at)}` : Math.floor(first.at / 60) <= Math.floor(now / 60) ? 'Зараз' : `Через ${span(Math.floor(first.at / 60) - Math.floor(now / 60))}`;
  const what = first.kind === 'slot' ? `слот ${first.title}` : first.kind === 'reminder' ? `нагадування: ${first.title}` : first.title.toLowerCase();
  const second = list[1];
  const hint = second ? `${prefix}Далі: ${model.tomorrow.includes(second) ? 'завтра ' : ''}${clockOf(second.at)} · ${second.title}` : `${prefix}Це остання подія`;
  return { when, what, hint, event: first };
}
