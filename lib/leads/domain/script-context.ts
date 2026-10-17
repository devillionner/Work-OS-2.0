import { lessonDateLabel, type ScriptValues } from '../../script-fields.ts';
import { lessonEpoch } from './time.ts';
import { safeUrl } from './validation.ts';

export type ScriptLesson = {
  id: string;
  subject: string;
  studentId: string | null;
  studentName?: string | null;
  teacherName: string;
  lessonDate: string;
  lessonTime: string;
  lessonPlatform: string | null;
  meetingLink: string;
  status: string;
};
export type ScriptLead = { name: string; subject: string; isStudent: number };
export type ScriptStudent = { id: string; name: string };
export type ScriptAudience = 'student' | 'adult';

/** Заплановані уроки за часом; найближчий (або останній минулий) стає уроком за замовчуванням. */
export function bookedLessons(lessons: readonly ScriptLesson[]): ScriptLesson[] {
  return lessons.filter((lesson) => lesson.status === 'booked').sort((a, b) => `${a.lessonDate} ${a.lessonTime}`.localeCompare(`${b.lessonDate} ${b.lessonTime}`));
}
export function defaultLesson(lessons: readonly ScriptLesson[], today: string): ScriptLesson | null {
  const booked = bookedLessons(lessons);
  return booked.find((lesson) => lesson.lessonDate >= today) ?? booked[booked.length - 1] ?? null;
}

/** За скільки до уроку ми зараз: «за годину» (до 2 год), «за день» (до 36 год) чи нічого. */
export function reminderKind(lesson: ScriptLesson | null, now: number): 'day' | 'hour' | null {
  if (!lesson || !lesson.lessonTime) return null;
  const start = lessonEpoch(lesson.lessonDate, lesson.lessonTime);
  if (start === null) return null;
  const hours = (start - now) / 3600;
  return hours > 0 && hours <= 2 ? 'hour' : hours > 2 && hours <= 36 ? 'day' : null;
}

/** Значення полів скрипту з даних ліда й уроку; порожнє поле лишається порожнім (його можна дописати перед копіюванням). */
export function scriptValues(lead: ScriptLead, lesson: ScriptLesson | null, students: readonly ScriptStudent[], audience: ScriptAudience): ScriptValues {
  const byId = lesson?.studentId ? students.find((student) => student.id === lesson.studentId)?.name : '';
  const student = (lesson?.studentName?.trim() || byId || (students.length === 1 ? students[0].name : '') || (lead.isStudent === 1 ? lead.name : '')).trim();
  const adult = lead.name.trim();
  const addressee = audience === 'student' ? student || adult : adult || student;
  return {
    addressee, student, adult,
    subject: lesson?.subject?.trim() || lead.subject.trim(),
    lessonDate: lessonDateLabel(lesson?.lessonDate),
    lessonTime: lesson?.lessonTime ?? '',
    teacher: lesson?.teacherName?.trim() ?? '',
    lessonPlatform: lesson?.lessonPlatform?.trim() ?? '',
    lessonLink: lesson && safeUrl(lesson.meetingLink) ? lesson.meetingLink : '',
  };
}
