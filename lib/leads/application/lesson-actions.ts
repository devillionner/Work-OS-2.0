import * as v from '../domain/validation.ts';
import type { ActionContext } from './context.ts';
import { lessonFields } from './inputs.ts';
import { businessDate, legacyLessonDate } from '../domain/time.ts';
import { defaultReminders, rescheduledReminders } from '../domain/reminders.ts';
import type { Lesson } from '../domain/types.ts';
export function applyLessonAction({
  action,
  data,
  entityId,
  aggregate,
  changes,
  now,
  event,
}: ActionContext) {
  const { lead } = changes;
  const { id, userId } = lead;
  const old =
    action === 'lesson_book'
      ? undefined
      : aggregate.lessons.find((l) => l.id === entityId);
  if (action !== 'lesson_book' && !old)
    throw new v.LeadError('Урок не знайдено.', 404);
  if (old && !['booked', 'scheduled'].includes(old.status))
    throw new v.LeadError(
      'Цей урок уже завершено, скасовано або перенесено.',
      409,
    );
  if (action === 'lesson_status') {
    v.only(data, ['status', 'reason']);
    const status = v.choice(
      data.status,
      ['completed', 'cancelled', 'no-show'],
      'Статус уроку',
    );
    const statusReason = v.string(
      data.reason,
      'Причина',
      2000,
      status !== 'completed',
    );
    changes.lessons.push({ ...old!, status, statusReason, updatedAt: now });
    lead.funnelStage = status === 'completed' ? 'result' : 'clarification';
    event(
      `lesson_${status === 'no-show' ? 'no_show' : status}`,
      status === 'completed' || status === 'no-show'
        ? legacyLessonDate(old!.lessonDate)
        : businessDate(now),
      old!.id,
      { reason: statusReason },
    );
  } else {
    let fields = data;
    let curatorRequestId: string | null = null;
    if (action === 'lesson_book') {
      if (data.curatorRequestId !== undefined)
        curatorRequestId = v.string(
          data.curatorRequestId,
          'Запит куратору',
          200,
          true,
        );
      if (aggregate.curatorRequests.length && !curatorRequestId)
        throw new v.LeadError(
          'Оберіть активний запит куратору для підтвердження цього запису.',
        );
      if (
        curatorRequestId &&
        !aggregate.curatorRequests.some(
          (r) => r.id === curatorRequestId && r.status === 'pending',
        )
      )
        throw new v.LeadError('Активний запит куратору не знайдено.', 409);
      fields = { ...data };
      delete fields.curatorRequestId;
    }
    let reason = '';
    if (action === 'lesson_reschedule') {
      reason = v.string(data.reason, 'Причина перенесення', 2000, true);
      fields = { ...data };
      delete fields.reason;
    }
    const parsed = lessonFields(
      fields,
      old
        ? { ...old, lessonDate: legacyLessonDate(old.lessonDate) }
        : undefined,
      now,
    );
    const student =
      parsed.studentId === null
        ? null
        : aggregate.students.find((s) => s.id === parsed.studentId);
    if (parsed.studentId && !student)
      throw new v.LeadError('Учень має належати цьому ліду.');
    if (
      action === 'lesson_update' &&
      (parsed.lessonDate !== legacyLessonDate(old!.lessonDate) ||
        parsed.lessonTime !== old!.lessonTime)
    )
      throw new v.LeadError(
        'Для зміни дати/часу використайте перенесення уроку.',
      );
    if (
      action === 'lesson_reschedule' &&
      parsed.lessonDate === legacyLessonDate(old!.lessonDate) &&
      parsed.lessonTime === old!.lessonTime
    )
      throw new v.LeadError('Оберіть нову дату або час.');
    if (
      old &&
      (action === 'lesson_reschedule' || old.rescheduledFromId) &&
      parsed.bookingDate !== old.bookingDate
    )
      throw new v.LeadError('Перенесення зберігає дату первинного запису.');
    const lessonId = action === 'lesson_update' ? old!.id : crypto.randomUUID();
    const lesson: Lesson = {
      id: lessonId,
      userId,
      leadId: id,
      legacyId: action === 'lesson_update' ? old!.legacyId : null,
      ...parsed,
      studentName: student
        ? `${student.name} ${student.surname}`.trim()
        : lead.name,
      bookingDate:
        action === 'lesson_reschedule' ? old!.bookingDate : parsed.bookingDate,
      status: 'booked',
      statusReason: '',
      rescheduledFromId:
        action === 'lesson_reschedule'
          ? old!.id
          : (old?.rescheduledFromId ?? null),
      createdAt: action === 'lesson_update' ? old!.createdAt : now,
      updatedAt: now,
    };
    changes.lessons.push(lesson);
    if (action === 'lesson_book') {
      if (curatorRequestId)
        changes.resolvedCuratorRequest = { id: curatorRequestId, lessonId };
      changes.reminders.push(
        ...defaultReminders(lessonId).map((r) => ({
          ...r,
          userId,
          lessonId,
          updatedAt: now,
        })),
      );
      lead.funnelStage = 'booked';
      event('lesson_booked', lesson.bookingDate!, lessonId, {
        bookingDate: lesson.bookingDate,
        lessonDate: lesson.lessonDate,
      });
    } else if (action === 'lesson_reschedule') {
      changes.lessons.unshift({
        ...old!,
        status: 'rescheduled',
        statusReason: reason,
        updatedAt: now,
      });
      const settings = aggregate.reminders.filter(
        (r) => r.lessonId === old!.id,
      );
      changes.reminders.push(
        ...rescheduledReminders(lessonId, settings).map((r) => ({
          ...r,
          userId,
          lessonId,
          updatedAt: now,
        })),
      );
      lead.funnelStage = 'booked';
      // A move is one reschedule, NOT a new booking metric.
      event('lesson_rescheduled', businessDate(now), lessonId, {
        previousLessonId: old!.id,
        reason,
        previousDate: old!.lessonDate,
        lessonDate: lesson.lessonDate,
      });
    } else {
      event('lesson_updated', businessDate(now), lessonId, {
        fields: Object.keys(fields),
        previousBookingDate: old!.bookingDate,
        bookingDate: lesson.bookingDate,
      });
    }
  }
}
