import { foldedName, leadSearchAliases } from './search.ts';
import { leadWriteGuards } from '../../../db/schema.ts';
import { and, asc, desc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
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
  MessageCursor,
  MessagePage,
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
  async load(
    userId: string,
    id: string,
    options: { messageLimit?: number; messagesBefore?: MessageCursor; messageId?: string } = {},
  ): Promise<Aggregate | null> {
    // One D1 batch gives a consistent snapshot and never reads another user's children.
    const messageLimit = options.messageLimit;
    const messagesBefore = options.messagesBefore;
    const messageId = options.messageId;
    const messageWhere = and(
      eq(leadMessages.leadId, id),
      eq(leadMessages.userId, userId),
      isNull(leadMessages.deletedAt),
      messageId ? eq(leadMessages.id, messageId) : undefined,
      messagesBefore
        ? sql`(${leadMessages.sentAt}, ${leadMessages.id}) < (${messagesBefore.sentAt}, ${messagesBefore.id})`
        : undefined,
    );
    const messageQuery =
      messageId !== undefined
        ? this.db.select().from(leadMessages).where(messageWhere).limit(1)
        : messageLimit === undefined
          ? this.db
              .select()
              .from(leadMessages)
              .where(messageWhere)
              .orderBy(asc(leadMessages.sentAt), asc(leadMessages.id))
          : this.db
              .select()
              .from(leadMessages)
              .where(messageWhere)
              .orderBy(desc(leadMessages.sentAt), desc(leadMessages.id))
              .limit(messageLimit === 0 ? 0 : messageLimit + 1);
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
      messageQuery,
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
    const reminderIndex = new Map(
      reminderRows.map(({ reminder }) => [
        `${reminder.lessonId}:${reminder.slot}`,
        reminder,
      ]),
    );
    const reminders = lessonRows.flatMap((l) =>
      defaultReminders(l.id).map(
        (d) =>
          reminderIndex.get(`${l.id}:${d.slot}`) ?? {
            ...d,
            userId,
            lessonId: l.id,
            updatedAt: l.updatedAt,
          },
      ),
    );
    const pagedMessages =
      messageId !== undefined || messageLimit === undefined
        ? messageRows
        : messageRows.slice(0, messageLimit).reverse();
    const hasMore =
      messageId === undefined &&
      messageLimit !== undefined &&
      messageLimit > 0 &&
      messageRows.length > messageLimit;
    const before =
      hasMore && pagedMessages[0]
        ? { sentAt: pagedMessages[0].sentAt, id: pagedMessages[0].id }
        : null;
    return {
      lead: leadRows[0],
      curatorRequests: curatorRows,
      students: studentRows,
      lessons: lessonRows,
      reminders,
      messages: pagedMessages,
      ...(messageLimit === undefined
        ? {}
        : { messagePage: { hasMore, before } }),
    };
  }
  async loadMessages(
    userId: string,
    leadId: string,
    options: { limit: number; before?: MessageCursor; version?: number },
  ): Promise<MessagePage | null> {
    const messageWhere = and(
      eq(leads.id, leadId),
      eq(leads.userId, userId),
    );
    const messageCursorWhere = and(
      eq(leadMessages.leadId, leadId),
      eq(leadMessages.userId, userId),
      isNull(leadMessages.deletedAt),
      options.before
        ? sql`(${leadMessages.sentAt}, ${leadMessages.id}) < (${options.before.sentAt}, ${options.before.id})`
        : undefined,
    );
    const [leadRows, messageRows] = await this.db.batch([
      this.db.select({ id: leads.id, version: leads.version }).from(leads).where(messageWhere),
      this.db
        .select()
        .from(leadMessages)
        .where(messageCursorWhere)
        .orderBy(desc(leadMessages.sentAt), desc(leadMessages.id))
        .limit(options.limit + 1),
    ]);
    if (!leadRows[0]) return null;
    if (options.version !== undefined && leadRows[0].version !== options.version)
      throw new LeadError('Переписку змінено. Оновіть картку ліда перед переглядом попередніх повідомлень.', 409);
    const messages = messageRows.slice(0, options.limit).reverse();
    const hasMore = messageRows.length > options.limit;
    return {
      messages,
      hasMore,
      before:
        hasMore && messages[0]
          ? { sentAt: messages[0].sentAt, id: messages[0].id }
          : null,
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
  async contacts(userId: string, contact: { phone: string; telegram: string }) {
    return this.db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        telegramUsername: leads.telegramUsername,
        archivedAt: leads.archivedAt,
      })
      .from(leads)
      .where(
        and(
          eq(leads.userId, userId),
          sql`(
        (${contact.phone} <> '' AND ${leads.normalizedPhone}=${contact.phone}) OR
        (${contact.telegram} <> '' AND ${leads.normalizedTelegram}=${contact.telegram}) OR
        ${leads.legacyId} IS NOT NULL OR ${leads.managedAt} IS NULL OR
        (${contact.phone} <> '' AND ${leads.normalizedPhone}='') OR
        (${contact.telegram} <> '' AND ${leads.normalizedTelegram}='')
      )`,
        ),
      );
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
    commands.push(
      this.db.insert(leadWriteGuards).values({
        leadId: receipt.leadId,
        userId: receipt.userId,
        expectedVersion: receipt.expectedVersion,
        curatorRequestId: c.resolvedCuratorRequest?.id ?? null,
      }),
    );
    commands.push(this.db.insert(leadCommands).values(receipt));
    if (c.createdCuratorRequest)
      commands.push(this.db.insert(curatorRequests).values(c.createdCuratorRequest));
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
    if (c.responseEventCancelledAt !== undefined)
      commands.push(
        this.db.update(activityEvents).set({ cancelledAt: c.responseEventCancelledAt }).where(
          and(
            eq(activityEvents.userId, c.lead.userId),
            eq(activityEvents.leadId, c.lead.id),
            eq(activityEvents.eventType, 'lead_created'),
          ),
        ),
      );
    if (c.resolvedCuratorRequest) {
      const resolved = c.resolvedCuratorRequest;
      commands.push(
        this.db
          .update(curatorRequests)
          .set({
            status: resolved.status,
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
              status: resolved.status,
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
    for (const correction of c.eventDateCorrections ?? []) {
      const metadataKey =
        correction.type === 'lead_created' ? '$.responseDate' : '$.bookingDate';
      commands.push(
        this.db
          .update(activityEvents)
          .set({
            eventDate: correction.date,
            metadataJson: sql`json_set(CASE WHEN json_valid(${activityEvents.metadataJson}) THEN ${activityEvents.metadataJson} ELSE '{}' END, ${metadataKey}, ${correction.date})`,
          })
          .where(
            and(
              eq(activityEvents.userId, c.lead.userId),
              eq(activityEvents.leadId, c.lead.id),
              eq(activityEvents.eventType, correction.type),
              correction.lessonId
                ? eq(activityEvents.lessonId, correction.lessonId)
                : undefined,
            ),
          ),
      );
    }
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
      responses?: boolean;
      curator?: boolean;
      needsDetails?: boolean;
      search: string;
      offset: number;
    },
    now: number,
  ) {
    const { search, offset } = options;
    const rawSearch = search.trim();
    const normalizedSearch = rawSearch.toLocaleLowerCase('uk-UA');
    const phoneSearch = rawSearch.replace(/\D/g, '');
    const telegramSearch = normalizedSearch
      .replace(/^@/, '')
      .replace(/^https?:\/\/(?:www\.)?t\.me\//, '')
      .split(/[/?#]/, 1)[0] ?? '';
    const aliases = new Set(leadSearchAliases(normalizedSearch));
    const searchFilters: SQL[] = [];
    if (normalizedSearch) {
      searchFilters.push(
        sql`instr(${foldedName(leads.name)},${normalizedSearch})>0`,
        sql`instr(${leads.phone},${rawSearch})>0`,
        sql`instr(${foldedName(leads.telegramUsername)},${normalizedSearch})>0`,
        sql`instr(${foldedName(leads.subject)},${normalizedSearch})>0`,
        sql`instr(${foldedName(leads.note)},${normalizedSearch})>0`,
        sql`instr(${foldedName(leads.platform)},${normalizedSearch})>0`,
        sql`instr(${foldedName(leads.sourceChatLink)},${normalizedSearch})>0`,
        sql`instr(${foldedName(leads.teacherName)},${normalizedSearch})>0`,
        sql`instr(${foldedName(leads.status)},${normalizedSearch})>0`,
        sql`instr(${foldedName(leads.funnelStage)},${normalizedSearch})>0`,
        sql`instr(${foldedName(leads.nextAction)},${normalizedSearch})>0`,
        sql`EXISTS (
          SELECT 1 FROM ${lessons}
          WHERE ${lessons.userId}=${userId}
            AND ${lessons.leadId}=${leads.id}
            AND (
              instr(${foldedName(lessons.teacherName)},${normalizedSearch})>0 OR
              instr(${foldedName(lessons.studentName)},${normalizedSearch})>0 OR
              instr(${foldedName(lessons.subject)},${normalizedSearch})>0
            )
        )`,
        sql`EXISTS (
          SELECT 1 FROM ${students}
          WHERE ${students.userId}=${userId}
            AND ${students.leadId}=${leads.id}
            AND (
              instr(${foldedName(students.name)},${normalizedSearch})>0 OR
              instr(${foldedName(students.surname)},${normalizedSearch})>0 OR
              instr(${foldedName(students.note)},${normalizedSearch})>0
            )
        )`,
      );
      if (phoneSearch.length >= 4)
        searchFilters.push(sql`instr(${leads.normalizedPhone},${phoneSearch})>0`);
      if (telegramSearch)
        searchFilters.push(sql`instr(${leads.normalizedTelegram},${telegramSearch})>0`);
      if (aliases.has('response'))
        searchFilters.push(eq(leads.funnelStage, 'response'));
      if (aliases.has('clarification'))
        searchFilters.push(sql`(${leads.funnelStage}='clarification' OR ${leads.needsDetails}=1)`);
      if (aliases.has('booked'))
        searchFilters.push(sql`(${leads.funnelStage}='booked' OR EXISTS (
          SELECT 1 FROM ${lessons}
          WHERE ${lessons.userId}=${userId}
            AND ${lessons.leadId}=${leads.id}
            AND ${lessons.status}='booked'
        ))`);
      if (aliases.has('reminder'))
        searchFilters.push(eq(leads.funnelStage, 'reminder'));
      if (aliases.has('lesson'))
        searchFilters.push(eq(leads.funnelStage, 'lesson'));
      if (aliases.has('result'))
        searchFilters.push(eq(leads.funnelStage, 'result'));
      if (aliases.has('curator'))
        searchFilters.push(sql`EXISTS (
          SELECT 1 FROM ${curatorRequests}
          WHERE ${curatorRequests.userId}=${userId}
            AND ${curatorRequests.leadId}=${leads.id}
            AND ${curatorRequests.status}='pending'
        )`);
      if (aliases.has('new')) searchFilters.push(eq(leads.status, 'new'));
      if (aliases.has('active')) searchFilters.push(eq(leads.status, 'active'));
      if (aliases.has('won')) searchFilters.push(eq(leads.status, 'won'));
      if (aliases.has('lost')) searchFilters.push(eq(leads.status, 'lost'));
    }
    const searchFilter = normalizedSearch ? or(...searchFilters) : undefined;
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
      options.responses
        ? sql`EXISTS (
            SELECT 1 FROM ${activityEvents}
            WHERE ${activityEvents.userId}=${userId}
              AND ${activityEvents.leadId}=${leads.id}
              AND ${activityEvents.eventType}='lead_created'
              AND ${activityEvents.cancelledAt} IS NULL
          )`
        : undefined,
      options.curator
        ? sql`EXISTS (
            SELECT 1 FROM ${curatorRequests}
            WHERE ${curatorRequests.userId}=${userId}
              AND ${curatorRequests.leadId}=${leads.id}
              AND ${curatorRequests.status}='pending'
          )`
        : undefined,
      options.needsDetails
        ? sql`(${leads.needsDetails}=1 OR ${leads.funnelStage}='clarification')`
        : undefined,
      searchFilter,
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
