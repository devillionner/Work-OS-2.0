import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';

// Maps the existing D1 tables. SQL migrations remain authoritative; never push a
// partial Drizzle schema over production (other domains still use their SQL schema).
export const leads = sqliteTable(
  'leads',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    legacyId: text('legacy_id'),
    name: text('name').notNull(),
    phone: text('phone').notNull().default(''),
    telegramUsername: text('telegram_username').notNull().default(''),
    normalizedPhone: text('normalized_phone').notNull().default(''),
    normalizedTelegram: text('normalized_telegram').notNull().default(''),
    platform: text('platform').notNull(),
    sourceChatId: text('source_chat_id'),
    sourceChatLink: text('source_chat_link').notNull().default(''),
    subject: text('subject').notNull().default(''),
    note: text('note').notNull().default(''),
    needsDetails: integer('needs_details').notNull().default(0),
    status: text('status').notNull(),
    teacherName: text('teacher_name').notNull().default(''),
    lessonPlatform: text('lesson_platform'),
    meetingLink: text('meeting_link').notNull().default(''),
    isStudent: integer('is_student').notNull().default(0),
    ageGroup: text('age_group').notNull().default(''),
    responseDate: text('response_date'),
    bookingDate: text('booking_date'),
    responseAt: integer('response_at'),
    firstReplyAt: integer('first_reply_at'),
    responseCancelledAt: integer('response_cancelled_at'),
    responseCancelledDate: text('response_cancelled_date'),
    qualification: text('qualification'),
    familyQualification: text('family_qualification'),
    duplicateState: text('duplicate_state').notNull().default('none'),
    funnelStage: text('funnel_stage').notNull().default('response'),
    nextAction: text('next_action').notNull().default(''),
    nextContactAt: integer('next_contact_at'),
    archivedAt: integer('archived_at'),
    bookedAt: integer('booked_at'),
    legacyPayloadJson: text('legacy_payload_json'),
    sourceImportId: text('source_import_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    managedAt: integer('managed_at'),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('leads_follow_up_idx').on(t.userId, t.archivedAt, t.nextContactAt),
    index('leads_owner_archive_updated_idx').on(
      t.userId,
      t.archivedAt,
      t.updatedAt,
      t.id,
    ),
  ],
);

export const students = sqliteTable('students', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  leadId: text('lead_id')
    .notNull()
    .references(() => leads.id),
  legacyId: text('legacy_id'),
  name: text('name').notNull(),
  surname: text('surname').notNull().default(''),
  ageGroup: text('age_group').notNull().default(''),
  grade: integer('grade'),
  note: text('note').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
export const lessons = sqliteTable(
  'lessons',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id),
    studentId: text('student_id').references(() => students.id),
    legacyId: text('legacy_id'),
    studentName: text('student_name').notNull(),
    subject: text('subject').notNull(),
    teacherName: text('teacher_name').notNull().default(''),
    lessonDate: text('lesson_date').notNull(),
    lessonTime: text('lesson_time').notNull().default(''),
    lessonPlatform: text('lesson_platform'),
    meetingLink: text('meeting_link').notNull().default(''),
    bookingDate: text('booking_date'),
    status: text('status').notNull().default('scheduled'),
    statusReason: text('status_reason').notNull().default(''),
    rescheduledFromId: text('rescheduled_from_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('lessons_one_replacement_idx').on(t.rescheduledFromId)],
);
export const lessonReminders = sqliteTable(
  'lesson_reminders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lessons.id),
    slot: integer('slot').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    offsetMinutes: integer('offset_minutes').notNull(),
    sentAt: integer('sent_at'),
    skippedAt: integer('skipped_at'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('lesson_reminders_slot_idx').on(t.lessonId, t.slot)],
);
export const leadMessages = sqliteTable('lead_messages', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  leadId: text('lead_id')
    .notNull()
    .references(() => leads.id),
  sender: text('sender').notNull(),
  body: text('body').notNull(),
  sentAt: integer('sent_at').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
});
export const activityEvents = sqliteTable(
  'activity_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    eventType: text('event_type').notNull(),
    platform: text('platform'),
    chatId: text('chat_id'),
    leadId: text('lead_id'),
    lessonId: text('lesson_id'),
    occurredAt: integer('occurred_at').notNull(),
    eventDate: text('event_date').notNull(),
    metadataJson: text('metadata_json').notNull().default('{}'),
    sourceKey: text('source_key').notNull(),
    sourceImportId: text('source_import_id'),
    telegramAccountId: text('telegram_account_id'),
    cancelledAt: integer('cancelled_at'),
  },
  (t) => [uniqueIndex('activity_events_source_idx').on(t.userId, t.sourceKey)],
);
export const leadCommands = sqliteTable('lead_commands', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  leadId: text('lead_id')
    .notNull()
    .references(() => leads.id),
  expectedVersion: integer('expected_version').notNull(),
  requestJson: text('request_json').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const curatorRequests = sqliteTable('curator_requests', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  leadId: text('lead_id').notNull(),
  legacyId: text('legacy_id'),
  status: text('status').notNull(),
  submittedAt: integer('submitted_at').notNull(),
  submittedDate: text('submitted_date').notNull(),
  resolvedAt: integer('resolved_at'),
  lessonId: text('lesson_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  sourceImportId: text('source_import_id'),
});

// Ephemeral compare-and-swap assertion; the trigger stores no rows.
export const leadWriteGuards = sqliteTable('lead_write_guards', {
  leadId: text('lead_id').notNull(),
  userId: text('user_id').notNull(),
  expectedVersion: integer('expected_version').notNull(),
  curatorRequestId: text('curator_request_id'),
});
