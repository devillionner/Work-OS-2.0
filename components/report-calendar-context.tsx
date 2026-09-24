import { calendarContextLabels, compactCalendarContextLabels, type CalendarDayContext } from '@/lib/reports/calendar-labels';

export function ReportCalendarContext({
  date,
  context,
}: {
  date: string;
  context?: CalendarDayContext;
}) {
  const labels = calendarContextLabels(date, context);
  const compact = compactCalendarContextLabels(date, context);
  if (!labels.length) return null;
  const visible = compact.slice(0, 2);
  const hiddenCount = Math.max(0, compact.length - visible.length);
  return (
    <small className="report-day-context" title={labels.join(' · ')} aria-hidden="true">
      {visible.map((label) => <span key={label}>{label}</span>)}
      {hiddenCount ? <span className="is-more">+{hiddenCount}</span> : null}
    </small>
  );
}
