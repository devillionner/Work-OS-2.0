import type { Aggregate } from '../domain/types.ts';
import { overdue, waitingSeconds, legacyLessonDate } from '../domain/time.ts';
import { reminderView } from '../domain/reminders.ts';
export function leadDetail(a: Aggregate, now: number) {
  const {
    legacyPayloadJson: _raw,
    sourceImportId: _import,
    userId: _owner,
    ...lead
  } = a.lead;
  return {
    lead: {
      ...lead,
      overdue: overdue(lead, now),
      waitingSeconds: waitingSeconds(lead.responseAt, lead.firstReplyAt, now),
    },
    curatorRequests: a.curatorRequests
      .filter((r) => r.status === 'pending')
      .map(({ id, submittedDate }) => ({ id, submittedDate })),
    students: a.students.map(({ userId: _user, ...s }) => s),
    lessons: a.lessons.map(({ userId: _user, ...l }) => ({
      ...l,
      lessonDate: legacyLessonDate(l.lessonDate),
      status: l.status === 'scheduled' ? 'booked' : l.status,
      reminders: a.reminders
        .filter((r) => r.lessonId === l.id)
        .map((r) => reminderView(l, r, now)),
    })),
    messages: a.messages
      .filter((m) => m.deletedAt === null)
      .map(({ userId: _user, ...m }) => m),
    serverNow: now,
  };
}
export type LeadDetail = ReturnType<typeof leadDetail>;
export function exportConversation(a: Aggregate) {
  return (
    `Work OS — внутрішня CRM-історія\nЛід: ${a.lead.name}\nЧас повідомлень: UTC (ISO 8601)\n\n` +
    a.messages
      .filter((m) => m.deletedAt === null)
      .sort((a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id))
      .map(
        (m) =>
          `[${new Date(m.sentAt * 1000).toISOString()}] ${m.sender === 'lead' ? 'Лід' : 'Я'}:\n${m.body}`,
      )
      .join('\n\n') +
    '\n'
  );
}
