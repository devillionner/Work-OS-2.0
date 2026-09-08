// Business timezone is explicit and independent of the browser/Worker timezone.
export const BUSINESS_TIMEZONE = 'Europe/Kyiv';
export function businessDate(epoch: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epoch * 1000));
}
export function legacyLessonDate(value: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/.exec(value);
  return m ? `${m[3].length === 2 ? '20' : ''}${m[3]}-${m[2]}-${m[1]}` : value;
}
function localParts(epoch: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(epoch * 1000))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function lessonEpoch(day: string, time: string): number | null {
  const local = `${legacyLessonDate(day)}T${time}`;
  const utc = Date.parse(`${local}:00Z`) / 1000;
  if (!Number.isFinite(utc) || !/^\d{2}:\d{2}$/.test(time)) return null;
  // Reject nonexistent/ambiguous DST wall times instead of silently moving a lesson.
  const candidates = [utc - 7200, utc - 10800].filter(
    (epoch) => localParts(epoch) === local,
  );
  return candidates.length === 1 ? candidates[0] : null;
}
export function overdue(
  lead: {
    archivedAt: number | null;
    nextAction: string;
    nextContactAt: number | null;
  },
  now: number,
): boolean {
  return (
    lead.archivedAt === null &&
    !!lead.nextAction.trim() &&
    lead.nextContactAt !== null &&
    lead.nextContactAt < now
  );
}
export function waitingSeconds(
  responseAt: number | null,
  firstReplyAt: number | null,
  now: number,
): number | null {
  return responseAt === null
    ? null
    : Math.max(0, (firstReplyAt ?? now) - responseAt);
}
export function businessDateTime(epoch: number): string {
  return localParts(epoch);
}
