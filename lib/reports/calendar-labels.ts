export type CalendarDayContext = {
  date: string;
  workdayStatus: 'active' | 'paused' | 'ended' | null;
  activeSeconds: number;
  lessons: number;
  lessonsPlanned: number;
  lessonsCompleted: number;
  followUps: number;
  leadEvents: number;
};

export function calendarContextLabels(date: string, context?: CalendarDayContext): string[] {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const labels = [context?.workdayStatus ? 'Робочий' : day === 0 || day === 6 ? 'Вихідний' : ''];
  if (context?.lessons) labels.push(`Уроки ${context.lessons}`);
  if (context?.followUps) labels.push(`Follow-up ${context.followUps}`);
  if (context?.leadEvents) labels.push(`CRM ${context.leadEvents}`);
  return labels.filter(Boolean);
}
