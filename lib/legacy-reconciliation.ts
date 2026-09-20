import { sha256Hex } from './legacy-backup.ts';
import type { LegacyMigrationDataset, MigrationPhase } from './legacy-migration.ts';

export type MigrationChunkReconciliation = {
  phase: MigrationPhase;
  expected: number;
  actual: number;
  expectedChecksum: string;
  actualChecksum: string;
  ok: boolean;
};

export type MigrationPhaseReconciliation = {
  expected: number;
  verified: number;
  expectedChecksum: string;
  actualChecksum: string;
  ok: boolean;
};

export type MigrationReconciliation = Partial<Record<MigrationPhase, MigrationPhaseReconciliation>>;

export async function reconcileMigrationChunk(
  db: D1Database,
  userId: string,
  phase: MigrationPhase,
  records: LegacyMigrationDataset[MigrationPhase],
): Promise<MigrationChunkReconciliation> {
  const expectedKeys = (records as unknown[]).map((record) => recordKey(phase, record));
  if (expectedKeys.some((key) => !key)) throw new Error(`Не вдалося звірити етап ${phase}: відсутній стабільний ключ.`);
  const uniqueKeys = [...new Set(expectedKeys)];
  const found = uniqueKeys.length
    ? await readActualRecords(db, userId, phase, uniqueKeys)
    : new Map<string, CanonicalRecord>();
  // Preserve source multiplicity while comparing the complete canonical payload.
  // Duplicate source records only pass when the final stable target matches each copy.
  const expectedRecords = (records as unknown[]).map((record) => canonicalExpectedRecord(phase, record, userId));
  const actualRecords = expectedKeys
    .map((key) => found.get(key))
    .filter((record): record is CanonicalRecord => Boolean(record));
  const expectedChecksum = await recordChecksum(expectedRecords);
  const actualChecksum = await recordChecksum(actualRecords);
  return {
    phase,
    expected: expectedKeys.length,
    actual: actualRecords.length,
    expectedChecksum,
    actualChecksum,
    ok: actualRecords.length === expectedKeys.length && actualChecksum === expectedChecksum,
  };
}

export async function appendMigrationReconciliation(
  current: MigrationReconciliation,
  phase: MigrationPhase,
  phaseTotal: number,
  cursor: number,
  chunk: MigrationChunkReconciliation,
): Promise<MigrationReconciliation> {
  const previous = current[phase];
  const previousVerified = previous?.verified || 0;
  if (previousVerified !== cursor) {
    throw new Error(`Стан звірки етапу ${phase} не збігається з прогресом переносу.`);
  }
  const expectedChecksum = await chainChecksum(previous?.expectedChecksum || '', chunk.expectedChecksum);
  const actualChecksum = await chainChecksum(previous?.actualChecksum || '', chunk.actualChecksum);
  const verified = cursor + chunk.expected;
  return {
    ...current,
    [phase]: {
      expected: phaseTotal,
      verified,
      expectedChecksum,
      actualChecksum,
      ok: Boolean(chunk.ok && expectedChecksum === actualChecksum && verified <= phaseTotal),
    },
  };
}

export function reconciliationComplete(
  value: MigrationReconciliation,
  phases: readonly MigrationPhase[],
): boolean {
  return phases.every((phase) => {
    const row = value[phase];
    return Boolean(row && row.ok && row.verified === row.expected);
  });
}

export function parseMigrationReconciliation(value: string | null | undefined): MigrationReconciliation {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: MigrationReconciliation = {};
    for (const [phase, row] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isMigrationPhase(phase) || !row || typeof row !== 'object' || Array.isArray(row)) continue;
      const value = row as Record<string, unknown>;
      const expected = Number(value.expected);
      const verified = Number(value.verified);
      const expectedChecksum = typeof value.expectedChecksum === 'string' ? value.expectedChecksum : '';
      const actualChecksum = typeof value.actualChecksum === 'string' ? value.actualChecksum : '';
      if (!Number.isSafeInteger(expected) || expected < 0 || !Number.isSafeInteger(verified) || verified < 0) continue;
      result[phase] = {
        expected,
        verified,
        expectedChecksum,
        actualChecksum,
        ok: value.ok === true && expectedChecksum === actualChecksum,
      };
    }
    return result;
  } catch {
    return {};
  }
}

function recordKey(phase: MigrationPhase, value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const row = value as Record<string, unknown>;
  if (phase === 'profiles') return text(row.chatId);
  if (phase === 'settings') return text(row.key);
  return text(row.id);
}

type CanonicalValue = string | number | boolean | null;
type CanonicalRecord = Record<string, CanonicalValue>;
type DbRow = Record<string, unknown>;

async function readActualRecords(
  db: D1Database,
  userId: string,
  phase: MigrationPhase,
  keys: string[],
): Promise<Map<string, CanonicalRecord>> {
  const encoded = JSON.stringify(keys);
  const statement = actualRecordQuery(db, userId, phase, encoded);
  const result = await statement.all<DbRow>();
  const rows = new Map<string, CanonicalRecord>();
  for (const row of result.results) {
    const key = actualText(row.key);
    if (!key) continue;
    rows.set(key, canonicalActualRecord(phase, row));
  }
  return rows;
}

function actualRecordQuery(
  db: D1Database,
  userId: string,
  phase: MigrationPhase,
  encodedKeys: string,
): D1PreparedStatement {
  const inKeys = `IN (SELECT value FROM json_each(?2))`;
  if (phase === 'accounts') {
    return db.prepare(`SELECT id AS key,account_number,name,is_enabled,is_selected,created_at,updated_at
      FROM telegram_accounts WHERE user_id=?1 AND id ${inKeys}`).bind(userId, encodedKeys);
  }
  if (phase === 'chats') {
    return db.prepare(`SELECT id AS key,platform,name,link,normalized_link,workflow_status,is_private,joined_at,processed_at,
      snoozed_until,archive_reason,archived_at,legacy_payload_json,created_at,updated_at,note,legacy_date,telegram_account_id
      FROM chats WHERE user_id=?1 AND id ${inKeys}`).bind(userId, encodedKeys);
  }
  if (phase === 'profiles') {
    return db.prepare(`SELECT p.chat_id AS key,p.language,p.cadence,p.weekdays_json,p.directions_json,p.note,
      p.review_status,p.source,p.updated_at FROM chat_profiles p JOIN chats c ON c.id=p.chat_id
      WHERE c.user_id=?1 AND p.chat_id ${inKeys}`).bind(userId, encodedKeys);
  }
  if (phase === 'publications') {
    return db.prepare(`SELECT p.id AS key,p.chat_id,p.published_on,p.published_at,p.source,p.source_key,p.created_at,
      p.telegram_account_id,c.telegram_account_id AS chat_telegram_account_id
      FROM chat_publications p JOIN chats c ON c.id=p.chat_id
      WHERE p.user_id=?1 AND p.id ${inKeys}`).bind(userId, encodedKeys);
  }
  if (phase === 'leads') {
    return db.prepare(`SELECT id AS key,legacy_id,name,phone,telegram_username,normalized_phone,normalized_telegram,
      platform,subject,source_chat_id,source_chat_link,note,needs_details,status,teacher_name,lesson_platform,meeting_link,
      is_student,age_group,response_date,booking_date,response_cancelled_at,response_cancelled_date,created_at,booked_at,
      archived_at,legacy_payload_json,updated_at FROM leads WHERE user_id=?1 AND id ${inKeys}`).bind(userId, encodedKeys);
  }
  if (phase === 'students') {
    return db.prepare(`SELECT id AS key,lead_id,legacy_id,name,surname,age_group,note,created_at,updated_at
      FROM students WHERE user_id=?1 AND id ${inKeys}`).bind(userId, encodedKeys);
  }
  if (phase === 'lessons') {
    return db.prepare(`SELECT id AS key,lead_id,student_id,legacy_id,student_name,subject,teacher_name,lesson_date,
      lesson_time,lesson_platform,meeting_link,status,booking_date,created_at,updated_at
      FROM lessons WHERE user_id=?1 AND id ${inKeys}`).bind(userId, encodedKeys);
  }
  if (phase === 'curatorRequests') {
    return db.prepare(`SELECT id AS key,lead_id,legacy_id,status,submitted_at,submitted_date,resolved_at,lesson_id,
      created_at,updated_at FROM curator_requests WHERE user_id=?1 AND id ${inKeys}`).bind(userId, encodedKeys);
  }
  if (phase === 'reports') {
    return db.prepare(`SELECT id AS key,report_date,report_text,payload_json,submitted_at,updated_at
      FROM daily_reports WHERE user_id=?1 AND id ${inKeys}`).bind(userId, encodedKeys);
  }
  if (phase === 'settings') {
    return db.prepare(`SELECT setting_key AS key,value_json,updated_at
      FROM user_settings WHERE user_id=?1 AND setting_key ${inKeys}`).bind(userId, encodedKeys);
  }
  return db.prepare(`SELECT id AS key,event_type,platform,chat_id,lead_id,lesson_id,occurred_at,event_date,
    metadata_json,source_key,telegram_account_id,cancelled_at
    FROM activity_events WHERE user_id=?1 AND id ${inKeys}`).bind(userId, encodedKeys);
}

function canonicalExpectedRecord(phase: MigrationPhase, value: unknown, userId: string): CanonicalRecord {
  if (!value || typeof value !== 'object') throw new Error(`Не вдалося звірити етап ${phase}: пошкоджений запис.`);
  if (phase === 'accounts') {
    const row = value as LegacyMigrationDataset['accounts'][number];
    return { key: row.id, number: row.number, name: row.name, enabled: 1, selected: row.selected, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }
  if (phase === 'chats') {
    const row = value as LegacyMigrationDataset['chats'][number];
    const telegramAccountId = row.telegramAccountId || (row.platform === 'telegram' && row.workflowStatus !== 'to_join' ? `${userId}:tg1` : null);
    return {
      key: row.id, platform: row.platform, name: row.name, link: row.link, normalizedLink: row.normalizedLink,
      workflowStatus: row.workflowStatus, isPrivate: row.isPrivate, joinedAt: row.joinedAt, processedAt: row.processedAt,
      snoozedUntil: row.snoozedUntil, archiveReason: row.archiveReason, archivedAt: row.archivedAt,
      payloadJson: row.payloadJson, createdAt: row.createdAt, updatedAt: row.updatedAt, note: row.note,
      legacyDate: row.legacyDate, telegramAccountId,
    };
  }
  if (phase === 'profiles') {
    const row = value as LegacyMigrationDataset['profiles'][number];
    return { key: row.chatId, language: row.language, cadence: row.cadence, weekdaysJson: row.weekdaysJson, directionsJson: row.directionsJson, note: row.note, reviewStatus: row.reviewStatus, source: row.source, updatedAt: row.updatedAt };
  }
  if (phase === 'publications') {
    const row = value as LegacyMigrationDataset['publications'][number];
    return { key: row.id, chatId: row.chatId, publishedOn: row.publishedOn, publishedAt: row.publishedAt, source: 'legacy', sourceKey: row.sourceKey, createdAt: row.createdAt, telegramAccountMatchesChat: true };
  }
  if (phase === 'leads') {
    const row = value as LegacyMigrationDataset['leads'][number];
    return {
      key: row.id, legacyId: row.legacyId, name: row.name, phone: row.phone, telegramUsername: row.telegramUsername,
      normalizedPhone: row.normalizedPhone, normalizedTelegram: row.normalizedTelegram, platform: row.platform,
      subject: row.subject, sourceChatId: row.sourceChatId, sourceChatLink: row.sourceChatLink, note: row.note,
      needsDetails: row.needsDetails, status: row.status, teacherName: row.teacherName, lessonPlatform: row.lessonPlatform,
      meetingLink: row.meetingLink, isStudent: row.isStudent, ageGroup: row.ageGroup, responseDate: row.responseDate,
      bookingDate: row.bookingDate, responseCancelledAt: row.responseCancelledAt, responseCancelledDate: row.responseCancelledDate,
      createdAt: row.createdAt, bookedAt: row.bookedAt, archivedAt: row.archivedAt, payloadJson: row.payloadJson, updatedAt: row.updatedAt,
    };
  }
  if (phase === 'students') {
    const row = value as LegacyMigrationDataset['students'][number];
    return { key: row.id, leadId: row.leadId, legacyId: row.legacyId, name: row.name, surname: row.surname, ageGroup: row.ageGroup, note: row.note, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }
  if (phase === 'lessons') {
    const row = value as LegacyMigrationDataset['lessons'][number];
    return {
      key: row.id, leadId: row.leadId, studentId: row.studentId, legacyId: row.legacyId, studentName: row.studentName,
      subject: row.subject, teacherName: row.teacherName, lessonDate: row.lessonDate, lessonTime: row.lessonTime,
      lessonPlatform: row.lessonPlatform, meetingLink: row.meetingLink, status: row.status, bookingDate: row.bookingDate,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }
  if (phase === 'curatorRequests') {
    const row = value as LegacyMigrationDataset['curatorRequests'][number];
    return { key: row.id, leadId: row.leadId, legacyId: row.legacyId, status: row.status, submittedAt: row.submittedAt, submittedDate: row.submittedDate, resolvedAt: row.resolvedAt, lessonId: row.lessonId, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }
  if (phase === 'reports') {
    const row = value as LegacyMigrationDataset['reports'][number];
    return { key: row.id, reportDate: row.reportDate, reportText: row.reportText, payloadJson: row.payloadJson, submittedAt: row.submittedAt, updatedAt: row.updatedAt };
  }
  if (phase === 'settings') {
    const row = value as LegacyMigrationDataset['settings'][number];
    return { key: row.key, valueJson: row.valueJson, updatedAt: row.updatedAt };
  }
  const row = value as LegacyMigrationDataset['events'][number];
  return {
    key: row.id, eventType: row.eventType, platform: row.platform, chatId: row.chatId, leadId: row.leadId,
    lessonId: row.lessonId, occurredAt: row.occurredAt, eventDate: row.eventDate, metadataJson: row.metadataJson,
    sourceKey: row.sourceKey, telegramAccountId: row.telegramAccountId, cancelledAt: row.cancelledAt,
  };
}

function canonicalActualRecord(phase: MigrationPhase, row: DbRow): CanonicalRecord {
  if (phase === 'accounts') {
    return { key: actualText(row.key), number: actualNumber(row.account_number), name: actualText(row.name), enabled: actualNumber(row.is_enabled), selected: actualNumber(row.is_selected), createdAt: actualNumber(row.created_at), updatedAt: actualNumber(row.updated_at) };
  }
  if (phase === 'chats') {
    return {
      key: actualText(row.key), platform: actualText(row.platform), name: actualText(row.name), link: actualText(row.link),
      normalizedLink: actualText(row.normalized_link), workflowStatus: actualText(row.workflow_status), isPrivate: actualNumber(row.is_private),
      joinedAt: actualNullableNumber(row.joined_at), processedAt: actualNullableNumber(row.processed_at), snoozedUntil: actualNullableNumber(row.snoozed_until),
      archiveReason: actualNullableText(row.archive_reason), archivedAt: actualNullableNumber(row.archived_at), payloadJson: actualText(row.legacy_payload_json),
      createdAt: actualNumber(row.created_at), updatedAt: actualNumber(row.updated_at), note: actualText(row.note),
      legacyDate: actualNullableText(row.legacy_date), telegramAccountId: actualNullableText(row.telegram_account_id),
    };
  }
  if (phase === 'profiles') {
    return { key: actualText(row.key), language: actualNullableText(row.language), cadence: actualText(row.cadence), weekdaysJson: actualText(row.weekdays_json), directionsJson: actualText(row.directions_json), note: actualText(row.note), reviewStatus: actualText(row.review_status), source: actualText(row.source), updatedAt: actualNumber(row.updated_at) };
  }
  if (phase === 'publications') {
    return {
      key: actualText(row.key), chatId: actualText(row.chat_id), publishedOn: actualText(row.published_on),
      publishedAt: actualNullableNumber(row.published_at), source: actualText(row.source), sourceKey: actualText(row.source_key),
      createdAt: actualNumber(row.created_at),
      telegramAccountMatchesChat: actualNullableText(row.telegram_account_id) === actualNullableText(row.chat_telegram_account_id),
    };
  }
  if (phase === 'leads') {
    return {
      key: actualText(row.key), legacyId: actualText(row.legacy_id), name: actualText(row.name), phone: actualText(row.phone),
      telegramUsername: actualText(row.telegram_username), normalizedPhone: actualText(row.normalized_phone),
      normalizedTelegram: actualText(row.normalized_telegram), platform: actualText(row.platform), subject: actualText(row.subject),
      sourceChatId: actualNullableText(row.source_chat_id), sourceChatLink: actualText(row.source_chat_link), note: actualText(row.note),
      needsDetails: actualNumber(row.needs_details), status: actualText(row.status), teacherName: actualText(row.teacher_name),
      lessonPlatform: actualNullableText(row.lesson_platform), meetingLink: actualText(row.meeting_link), isStudent: actualNumber(row.is_student),
      ageGroup: actualText(row.age_group), responseDate: actualText(row.response_date), bookingDate: actualNullableText(row.booking_date),
      responseCancelledAt: actualNullableNumber(row.response_cancelled_at), responseCancelledDate: actualNullableText(row.response_cancelled_date),
      createdAt: actualNumber(row.created_at), bookedAt: actualNullableNumber(row.booked_at), archivedAt: actualNullableNumber(row.archived_at),
      payloadJson: actualText(row.legacy_payload_json), updatedAt: actualNumber(row.updated_at),
    };
  }
  if (phase === 'students') {
    return { key: actualText(row.key), leadId: actualText(row.lead_id), legacyId: actualText(row.legacy_id), name: actualText(row.name), surname: actualText(row.surname), ageGroup: actualText(row.age_group), note: actualText(row.note), createdAt: actualNumber(row.created_at), updatedAt: actualNumber(row.updated_at) };
  }
  if (phase === 'lessons') {
    return {
      key: actualText(row.key), leadId: actualText(row.lead_id), studentId: actualNullableText(row.student_id), legacyId: actualText(row.legacy_id),
      studentName: actualText(row.student_name), subject: actualText(row.subject), teacherName: actualText(row.teacher_name),
      lessonDate: actualText(row.lesson_date), lessonTime: actualText(row.lesson_time), lessonPlatform: actualNullableText(row.lesson_platform),
      meetingLink: actualText(row.meeting_link), status: actualText(row.status), bookingDate: actualText(row.booking_date),
      createdAt: actualNumber(row.created_at), updatedAt: actualNumber(row.updated_at),
    };
  }
  if (phase === 'curatorRequests') {
    return { key: actualText(row.key), leadId: actualText(row.lead_id), legacyId: actualText(row.legacy_id), status: actualText(row.status), submittedAt: actualNumber(row.submitted_at), submittedDate: actualText(row.submitted_date), resolvedAt: actualNullableNumber(row.resolved_at), lessonId: actualNullableText(row.lesson_id), createdAt: actualNumber(row.created_at), updatedAt: actualNumber(row.updated_at) };
  }
  if (phase === 'reports') {
    return { key: actualText(row.key), reportDate: actualText(row.report_date), reportText: actualText(row.report_text), payloadJson: actualText(row.payload_json), submittedAt: actualNullableNumber(row.submitted_at), updatedAt: actualNumber(row.updated_at) };
  }
  if (phase === 'settings') {
    return { key: actualText(row.key), valueJson: actualText(row.value_json), updatedAt: actualNumber(row.updated_at) };
  }
  return {
    key: actualText(row.key), eventType: actualText(row.event_type), platform: actualNullableText(row.platform),
    chatId: actualNullableText(row.chat_id), leadId: actualNullableText(row.lead_id), lessonId: actualNullableText(row.lesson_id),
    occurredAt: actualNumber(row.occurred_at), eventDate: actualText(row.event_date), metadataJson: actualText(row.metadata_json),
    sourceKey: actualText(row.source_key), telegramAccountId: actualNullableText(row.telegram_account_id),
    cancelledAt: actualNullableNumber(row.cancelled_at),
  };
}

async function recordChecksum(records: CanonicalRecord[]): Promise<string> {
  return sha256Hex(records.map((record) => JSON.stringify(record)).sort().join('\n'));
}

function actualText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return '';
}
function actualNullableText(value: unknown): string | null {
  return value == null ? null : actualText(value);
}
function actualNumber(value: unknown): number {
  return Number(value);
}
function actualNullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

async function chainChecksum(previous: string, next: string): Promise<string> {
  return sha256Hex(`${previous}\n${next}`);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isMigrationPhase(value: string): value is MigrationPhase {
  return ['accounts','chats','profiles','publications','leads','students','lessons','curatorRequests','reports','settings','events'].includes(value);
}
