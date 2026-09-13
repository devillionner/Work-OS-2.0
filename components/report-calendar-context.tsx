import { calendarContextLabels, type CalendarDayContext } from '@/lib/reports/calendar-labels';

export function ReportCalendarContext({
  date,
  context,
}: {
  date: string;
  context?: CalendarDayContext;
}) {
  const labels = calendarContextLabels(date, context);
  if (!labels.length) return null;
  return (
    <small className="report-day-context" aria-label={labels.join(', ')}>
      {labels.map((label) => <span key={label}>{label}</span>)}
    </small>
  );
}
