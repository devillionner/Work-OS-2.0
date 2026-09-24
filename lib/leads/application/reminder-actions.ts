import * as v from '../domain/validation.ts';
import type { ActionContext } from './context.ts';
import { businessDate } from '../domain/time.ts';
import { reminderView } from '../domain/reminders.ts';
export function applyReminderAction({
  action,
  data,
  entityId,
  aggregate,
  changes,
  now,
  event,
}: ActionContext) {
  const { lead } = changes;
  const reminder = aggregate.reminders.find((r) => r.id === entityId);
  if (!reminder) throw new v.LeadError('Нагадування не знайдено.', 404);
  const lesson = aggregate.lessons.find((l) => l.id === reminder.lessonId)!;
  if (!['booked', 'scheduled'].includes(lesson.status))
    throw new v.LeadError(
      'Нагадування неактивного уроку змінювати не можна.',
      409,
    );
  const changed = { ...reminder, updatedAt: now };
  if (action === 'reminder_update') {
    v.only(data, ['enabled', 'offsetMinutes']);
    if (typeof data.enabled !== 'boolean')
      throw new v.LeadError('Перевірте перемикач нагадування.');
    changed.enabled = data.enabled;
    changed.offsetMinutes = v.integer(
      data.offsetMinutes,
      'Offset у хвилинах',
      0,
      43200,
    );
  } else {
    v.only(data, ['state']);
    const state = v.choice(data.state, ['sent', 'skipped'], 'Стан нагадування');
    if (
      !reminder.enabled ||
      reminder.sentAt !== null ||
      reminder.skippedAt !== null
    )
      throw new v.LeadError('Нагадування вимкнено або вже оброблено.', 409);
    if (
      state === 'sent' &&
      !['pending', 'due'].includes(reminderView(lesson, reminder, now).state)
    )
      throw new v.LeadError(
        'Доповніть дані уроку; надсилати нагадування після початку уроку не можна.',
      );
    changed.sentAt = state === 'sent' ? now : null;
    changed.skippedAt = state === 'skipped' ? now : null;
    if (state === 'sent') lead.funnelStage = 'reminder';
    event(`reminder_${state}`, businessDate(now), lesson.id, {
      slot: reminder.slot,
    });
  }
  changes.reminders.push(changed);
}
