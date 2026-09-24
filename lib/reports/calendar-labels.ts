export type CalendarDayContext = {
  date: string;
  workdayStatus: 'active' | 'paused' | 'ended' | null;
  activeSeconds: number;
  lessons: number;
  lessonsPlanned: number;
  lessonsCompleted: number;
  lessonsCancelled: number;
  lessonsNoShow: number;
  followUps: number;
  leadEvents: number;
};

export function calendarContextLabels(date: string, context?: CalendarDayContext): string[] {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const labels = [context?.workdayStatus ? 'Робочий' : day === 0 || day === 6 ? 'Вихідний' : ''];
  if (context?.lessonsPlanned) labels.push(`Заплановано уроків ${context.lessonsPlanned}`);
  if (context?.lessonsCompleted) labels.push(`Проведено уроків ${context.lessonsCompleted}`);
  if (context?.lessonsCancelled) labels.push(`Скасовано уроків ${context.lessonsCancelled}`);
  if (context?.lessonsNoShow) labels.push(`Неявка ${context.lessonsNoShow}`);
  const classifiedLessons = (context?.lessonsPlanned || 0) + (context?.lessonsCompleted || 0) + (context?.lessonsCancelled || 0) + (context?.lessonsNoShow || 0);
  if (context && context.lessons > classifiedLessons) labels.push(`Інші результати уроків ${context.lessons - classifiedLessons}`);
  if (context?.followUps) labels.push(`Follow-up ${context.followUps}`);
  if (context?.leadEvents) labels.push(`Події лідів ${context.leadEvents}`);
  return labels.filter(Boolean);
}

export function compactCalendarContextLabels(date: string, context?: CalendarDayContext): string[] {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const labels: string[] = [];
  if (context?.lessonsPlanned) labels.push(`Пл. ${context.lessonsPlanned}`);
  if (context?.lessonsCompleted) labels.push(`Ур. ${context.lessonsCompleted}`);
  if (context?.lessonsCancelled) labels.push(`Ск. ${context.lessonsCancelled}`);
  if (context?.lessonsNoShow) labels.push(`Н/я ${context.lessonsNoShow}`);
  const classifiedLessons = (context?.lessonsPlanned || 0) + (context?.lessonsCompleted || 0) + (context?.lessonsCancelled || 0) + (context?.lessonsNoShow || 0);
  if (context && context.lessons > classifiedLessons) labels.push(`Ін. ${context.lessons - classifiedLessons}`);
  if (context?.followUps) labels.push(`Пов. ${context.followUps}`);
  if (context?.leadEvents) labels.push(`Лід ${context.leadEvents}`);
  if (!labels.length && context?.workdayStatus) labels.push('Роб.');
  if (!labels.length && !context?.workdayStatus && (day === 0 || day === 6)) labels.push('Вих.');
  return labels;
}
