import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { BatchItem } from 'drizzle-orm/batch';
import * as schema from '../../../db/schema.ts';
import {
  leads,
  students,
  lessons,
  lessonReminders,
  leadMessages,
  activityEvents,
  leadCommands,
  curatorRequests,
} from '../../../db/schema.ts';
import type {
  Aggregate,
  Changes,
  LeadRepository,
  Receipt,
} from '../domain/types.ts';
import { defaultReminders } from '../domain/reminders.ts';
import { LeadError } from '../domain/validation.ts';
// Read-only attribution projection; all columns used here already exist.
const leadSourceChats = sqliteTable('chats', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  platform: text('platform').notNull(),
  normalizedLink: text('normalized_link').notNull(),
  telegramAccountId: text('telegram_account_id'),
});

export type LeadsDb = DrizzleD1Database<typeof schema>;
export class D1LeadRepository implements LeadRepository {
  db: LeadsDb;
  constructor(db: LeadsDb) {
    this.db = db;
  }
  async load(userId: string, id: string): Promise<Aggregate | null> {
    // One D1 batch gives a consistent snapshot and never reads another user's children.
    const [
      leadRows,
      studentRows,
      lessonRows,
      reminderRows,
      messageRows,
      curatorRows,
    ] = await this.db.batch([
      this.db
        .select()
        .from(leads)
        .where(and(eq(leads.id, id), eq(leads.userId, userId))),
      this.db
        .select()
        .from(students)
        .where(and(eq(students.leadId, id), eq(students.userId, userId)))
        .orderBy(asc(students.createdAt), asc(students.id)),
      this.db
        .select()
        .from(lessons)
        .where(and(eq(lessons.leadId, id), eq(lessons.userId, userId)))
        .orderBy(desc(lessons.createdAt), asc(lessons.id)),
      this.db
        .select({ reminder: lessonReminders })
        .from(lessonReminders)
        .innerJoin(lessons, eq(lessons.id, lessonReminders.lessonId))
        .where(
          and(
            eq(lessons.leadId, id),
            eq(lessons.userId, userId),
            eq(lessonReminders.userId, userId),
          ),
        ),
      this.db
        .select()
        .from(leadMessages)
        .where(
          and(
            eq(leadMessages.leadId, id),
            eq(leadMessages.userId, userId),
            isNull(leadMessages.deletedAt),
          ),
        )
        .orderBy(asc(leadMessages.sentAt), asc(leadMessages.id)),
      this.db
        .select()
        .from(curatorRequests)
        .where(
          and(
            eq(curatorRequests.leadId, id),
            eq(curatorRequests.userId, userId),
            eq(curatorRequests.status, 'pending'),
          ),
        ),
    ]);
    if (!leadRows[0]) return null;
    // Old/repeated imports may have no reminder rows. Defaults are a projection,
    // persisted only on the next command (no writes during GET).
    const reminders = lessonRows.flatMap((l) =>
      defaultReminders(l.id).map(
        (d) =>
          reminderRows.find(
            (r) => r.reminder.lessonId === l.id && r.reminder.slot === d.slot,
          )?.reminder ?? {
            ...d,
            userId,
            lessonId: l.id,
            updatedAt: l.updatedAt,
          },
      ),
    );
    return {
      lead: leadRows[0],
      curatorRequests: curatorRows,
      students: studentRows,
      lessons: lessonRows,
      reminders,
      messages: messageRows,
    };
  }
  async receipt(userId: string, id: string) {
    return (
      (await this.db
        .select()
        .from(leadCommands)
        .where(and(eq(leadCommands.id, id), eq(leadCommands.userId, userId)))
        .get()) ?? null
    );
  }
  async contacts(userId: string) {
    return this.db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        telegramUsername: leads.telegramUsername,
        archivedAt: leads.archivedAt,
      })
      .from(leads)
      .where(eq(leads.userId, userId));
  }
  async source(userId: string, link: string, platform: string) {
    if (!link) return null;
    let normalized = link.trim();
    try {
      const url = new URL(normalized);
      url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
      url.hash = '';
      url.pathname = url.pathname.replace(/\/+$/, '') || '/';
      normalized = url.toString();
    } catch {
      return null;
    }
    return (
      (await this.db
        .select({
          id: leadSourceChats.id,
          telegramAccountId: leadSourceChats.telegramAccountId,
        })
        .from(leadSourceChats)
        .where(
          and(
            eq(leadSourceChats.userId, userId),
            eq(leadSourceChats.platform, platform),
            eq(leadSourceChats.normalizedLink, normalized),
          ),
        )
        .get()) ?? null
    );
  }
  async commit(c: Changes, receipt: Receipt) {
    const commands: BatchItem<'sqlite'>[] = [];
    if (c.create)
      commands.push(this.db.insert(leads).values({ ...c.lead, version: 0 }));
    commands.push(this.db.insert(leadCommands).values(receipt));
    commands.push(
      this.db
        .update(leads)
        .set(c.lead)
        .where(and(eq(leads.id, c.lead.id), eq(leads.userId, c.lead.userId))),
    );
    for (const student of c.students)
      commands.push(
        this.db
          .insert(students)
          .values(student)
          .onConflictDoUpdate({ target: students.id, set: student }),
      );
    for (const lesson of c.lessons)
      commands.push(
        this.db
          .insert(lessons)
          .values(lesson)
          .onConflictDoUpdate({ target: lessons.id, set: lesson }),
      );
    for (const reminder of c.reminders)
      commands.push(
        this.db
          .insert(lessonReminders)
          .values(reminder)
          .onConflictDoUpdate({
            target: [lessonReminders.lessonId, lessonReminders.slot],
            set: reminder,
          }),
      );
    for (const message of c.messages)
      commands.push(
        this.db
          .insert(leadMessages)
          .values(message)
          .onConflictDoUpdate({ target: leadMessages.id, set: message }),
      );
    for (const event of c.events)
      commands.push(this.db.insert(activityEvents).values(event));
    if (c.resolvedCuratorRequest) {
      const resolved = c.resolvedCuratorRequest;
      commands.push(
        this.db
          .update(curatorRequests)
          .set({
            status: 'confirmed',
            lessonId: resolved.lessonId,
            resolvedAt: receipt.createdAt,
            updatedAt: receipt.createdAt,
          })
          .where(
            and(
              eq(curatorRequests.id, resolved.id),
              eq(curatorRequests.userId, c.lead.userId),
              eq(curatorRequests.leadId, c.lead.id),
              eq(curatorRequests.status, 'pending'),
            ),
          ),
      );
      commands.push(
        this.db
          .update(activityEvents)
          .set({
            cancelledAt: receipt.createdAt,
            metadataJson: JSON.stringify({
              curatorRequestId: resolved.id,
              status: 'confirmed',
            }),
          })
          .where(
            and(
              eq(activityEvents.userId, c.lead.userId),
              eq(activityEvents.leadId, c.lead.id),
              eq(activityEvents.eventType, 'curator_booking_pending'),
              sql`json_extract(${activityEvents.metadataJson}, '$.curatorRequestId') = ${resolved.id}`,
            ),
          ),
      );
    }
    // Explicit business-date corrections keep one canonical metric; audit events
    // above retain the old/new dates. Archive never cancels historical events.
    if (
      c.events.some((e) => e.eventType === 'lead_updated') &&
      c.lead.responseDate
    )
      commands.push(
        this.db
          .update(activityEvents)
          .set({ eventDate: c.lead.responseDate })
          .where(
            and(
              eq(activityEvents.userId, c.lead.userId),
              eq(activityEvents.leadId, c.lead.id),
              eq(activityEvents.eventType, 'lead_created'),
            ),
          ),
      );
    for (const lesson of c.lessons)
      if (
        c.events.some(
          (e) => e.eventType === 'lesson_updated' && e.lessonId === lesson.id,
        ) &&
        lesson.bookingDate
      )
        commands.push(
          this.db
            .update(activityEvents)
            .set({ eventDate: lesson.bookingDate })
            .where(
              and(
                eq(activityEvents.userId, c.lead.userId),
                eq(activityEvents.lessonId, lesson.id),
                eq(activityEvents.eventType, 'lesson_booked'),
              ),
            ),
        );
    try {
      await this.db.batch(
        commands as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]],
      );
    } catch (error) {
      const message =
        String(error) + String(error instanceof Error ? error.cause : '');
      if (/lead_version_conflict/.test(message))
        throw new LeadError(
          'Запис змінено на іншому пристрої. Оновіть картку.',
          409,
        );
      if (/lead_duplicate_contact/.test(message))
        throw new LeadError(
          'Контакт уже є в CRM. Оновіть список і перевірте дублікат.',
          409,
        );
      if (/UNIQUE constraint/.test(message))
        throw new LeadError(
          'Цю операцію вже виконано або запис змінився. Оновіть картку.',
          409,
        );
      throw error;
    }
  }
  async list(
    userId: string,
    options: {
      archived: boolean;
      overdue: boolean;
      search: string;
      offset: number;
    },
    now: number,
  ) {
    const { search, offset } = options;
    const filter = and(
      eq(leads.userId, userId),
      options.archived
        ? sql`${leads.archivedAt} IS NOT NULL`
        : isNull(leads.archivedAt),
      options.overdue
        ? and(
            lt(leads.nextContactAt, now),
            sql`trim(${leads.nextAction}) <> ''`,
            isNull(leads.archivedAt),
          )
        : undefined,
      search
        ? sql`(instr(lower(${leads.name}),lower(${search}))>0 OR instr(${leads.phone},${search})>0 OR instr(lower(${leads.telegramUsername}),lower(${search}))>0)`
        : undefined,
    );
    const [rows, totals] = await this.db.batch([
      this.db
        .select({
          id: leads.id,
          name: leads.name,
          platform: leads.platform,
          subject: leads.subject,
          status: leads.status,
          funnelStage: leads.funnelStage,
          qualification: leads.qualification,
          duplicateState: leads.duplicateState,
          responseDate: leads.responseDate,
          nextAction: leads.nextAction,
          nextContactAt: leads.nextContactAt,
          archivedAt: leads.archivedAt,
        })
        .from(leads)
        .where(filter)
        .orderBy(
          options.overdue ? asc(leads.nextContactAt) : desc(leads.updatedAt),
          asc(leads.id),
        )
        .limit(50)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(leads)
        .where(filter),
    ]);
    return { leads: rows, total: Number(totals[0].count), offset };
  }
}
