import type {
  leads,
  students,
  lessons,
  lessonReminders,
  leadMessages,
  leadMessageAttachments,
  activityEvents,
  curatorRequests,
} from '../../../db/schema.ts';
export type Lead = typeof leads.$inferSelect;
export type Student = typeof students.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
export type Reminder = typeof lessonReminders.$inferSelect;
export type Message = typeof leadMessages.$inferSelect;
export type Attachment = typeof leadMessageAttachments.$inferSelect;
export type Event = typeof activityEvents.$inferInsert;
export type CuratorRequest = typeof curatorRequests.$inferSelect;
export type MessageCursor = Pick<Message, 'sentAt' | 'id'>;
export type MessagePage = {
  messages: Message[];
  attachments: Attachment[];
  hasMore: boolean;
  before: MessageCursor | null;
};
export type Aggregate = {
  curatorRequests: CuratorRequest[];
  lead: Lead;
  students: Student[];
  lessons: Lesson[];
  reminders: Reminder[];
  messages: Message[];
  attachments: Attachment[];
  messagePage?: Omit<MessagePage, 'messages' | 'attachments'>;
};
export type Changes = {
  lead: Lead;
  create: boolean;
  students: Student[];
  lessons: Lesson[];
  reminders: Reminder[];
  messages: Message[];
  events: Event[];
  createdCuratorRequest?: CuratorRequest;
  responseEventCancelledAt?: number | null;
  /** Уроки (ланцюг переносів), чий запис `lesson_booked` гасне, бо урок скасовано. */
  bookingCancelledLessonIds?: string[];
  eventDateCorrections?: Array<{
    type: 'lead_created' | 'lesson_booked';
    date: string;
    lessonId?: string;
  }>;
  resolvedCuratorRequest?: {
    id: string;
    lessonId: string | null;
    status: 'confirmed' | 'cancelled';
  };
};
export type Receipt = {
  id: string;
  userId: string;
  leadId: string;
  expectedVersion: number;
  requestJson: string;
  createdAt: number;
};
/** Чат Work OS, з якого прийшов лід: потрібен для зв'язку за id, подій і підпису в картці. */
export type SourceChat = {
  id: string;
  telegramAccountId: string | null;
  platform: string;
  link: string;
  name: string;
};
export interface LeadRepository {
  load(
    userId: string,
    id: string,
    options?: { messageLimit?: number; messagesBefore?: MessageCursor; messageId?: string },
  ): Promise<Aggregate | null>;
  loadMessages(
    userId: string,
    leadId: string,
    options: { limit: number; before?: MessageCursor; version?: number },
  ): Promise<MessagePage | null>;
  receipt(userId: string, id: string): Promise<Receipt | null>;
  contacts(
    userId: string,
    contact: { phone: string; telegram: string },
  ): Promise<
    Array<
      Pick<Lead, 'id' | 'name' | 'phone' | 'telegramUsername' | 'archivedAt'>
    >
  >;
  source(
    userId: string,
    link: string,
    platform: string,
  ): Promise<SourceChat | null>;
  sourceById(userId: string, id: string): Promise<SourceChat | null>;
  commit(changes: Changes, receipt: Receipt): Promise<void>;
}
