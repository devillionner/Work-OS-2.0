import { lessonEpoch } from './time.ts';
import { safeUrl } from './validation.ts';
export type ReminderSettings = {
  id: string;
  slot: number;
  enabled: boolean;
  offsetMinutes: number;
  sentAt: number | null;
  skippedAt: number | null;
};
export type ReminderLesson = {
  id: string;
  subject: string;
  studentName: string;
  teacherName: string;
  lessonDate: string;
  lessonTime: string;
  lessonPlatform: string | null;
  meetingLink: string;
  status: string;
};
export function defaultReminders(lessonId: string): ReminderSettings[] {
  return [1440, 60].map((offsetMinutes, i) => ({
    id: `${lessonId}:reminder:${i + 1}`,
    slot: i + 1,
    enabled: true,
    offsetMinutes,
    sentAt: null,
    skippedAt: null,
  }));
}
export function rescheduledReminders(
  lessonId: string,
  old: ReminderSettings[],
): ReminderSettings[] {
  return defaultReminders(lessonId).map((r) => {
    const source = old.find((s) => s.slot === r.slot);
    return {
      ...r,
      enabled: source?.enabled ?? r.enabled,
      offsetMinutes: source?.offsetMinutes ?? r.offsetMinutes,
    };
  });
}
export function reminderView(
  lesson: ReminderLesson,
  reminder: ReminderSettings,
  now: number,
) {
  const startsAt = lessonEpoch(lesson.lessonDate, lesson.lessonTime);
  const missing = [
    !lesson.subject.trim() || lesson.subject === 'Не вказано' ? 'предмет' : '',
    !lesson.studentName.trim() ? 'учень' : '',
    !lesson.teacherName.trim() ? 'викладач' : '',
    !startsAt ? 'дата/час (Київ)' : '',
    !lesson.lessonPlatform?.trim() ? 'платформа зустрічі' : '',
    !safeUrl(lesson.meetingLink) ? 'посилання зустрічі' : '',
  ].filter(Boolean);
  const dueAt =
    startsAt === null ? null : startsAt - reminder.offsetMinutes * 60;
  const state =
    reminder.sentAt !== null
      ? 'sent'
      : reminder.skippedAt !== null
        ? 'skipped'
        : !reminder.enabled
          ? 'disabled'
          : !['booked', 'scheduled'].includes(lesson.status)
            ? 'inactive'
            : missing.length
              ? 'needs-data'
              : dueAt !== null && dueAt <= now
                ? 'due'
                : 'pending';
  const text =
    missing.length || !['due', 'pending'].includes(state)
      ? null
      : `Нагадуємо про урок: ${lesson.subject}. Учень: ${lesson.studentName}. ${lesson.lessonDate} о ${lesson.lessonTime} (Київ). Викладач: ${lesson.teacherName}. ${lesson.lessonPlatform}: ${lesson.meetingLink}`;
  return { ...reminder, dueAt, state, missing, text };
}
