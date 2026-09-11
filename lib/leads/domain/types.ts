import type {
  leads,
  students,
  lessons,
  lessonReminders,
  leadMessages,
  activityEvents,
  curatorRequests,
} from '../../../db/schema.ts';
export type Lead = typeof leads.$inferSelect;
export type Student = typeof students.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
export type Reminder = typeof lessonReminders.$inferSelect;
export type Message = typeof leadMessages.$inferSelect;
export type Event = typeof activityEvents.$inferInsert;
export type CuratorRequest = typeof curatorRequests.$inferSelect;
export type Aggregate = {
  curatorRequests: CuratorRequest[];
  lead: Lead;
  students: Student[];
  lessons: Lesson[];
  reminders: Reminder[];
  messages: Message[];
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
export interface LeadRepository {
  load(userId: string, id: string): Promise<Aggregate | null>;
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
  ): Promise<{ id: string; telegramAccountId: string | null } | null>;
  commit(changes: Changes, receipt: Receipt): Promise<void>;
}
