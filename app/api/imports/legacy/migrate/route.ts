import { legacyLeadGuards } from '@/lib/leads/data/import-guards';
import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import {
  buildLegacyMigrationDataset,
  MIGRATION_PHASES,
  migrationTotals,
  type LegacyMigrationDataset,
  type MigrationPhase,
} from '@/lib/legacy-migration';
import { sha256Hex } from '@/lib/legacy-backup';
import { readJsonObject, sameOrigin } from '@/lib/http-json';

// Each Leads record now includes parent/conflict guards in the same batch.
const RECORDS_PER_STEP = 10;
const RECORDS_PER_STAGED_CHUNK = 200;

type ImportRow = { id: string; sha256: string; status: string };
type JobRow = {
  id: string; import_id: string; status: string; phase: string; cursor: number;
  totals_json: string; processed_json: string; error_message: string | null;
};

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const job = await latestJob(user.id);
  return Response.json({ job: job ? publicJob(job) : null });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });

  const parsed = await readJsonObject(request, 16 * 1024);
  if (parsed instanceof Response) return parsed;
  const body = parsed as { action?: unknown; importId?: unknown };
  if (body.action === 'start') return startMigration(user.id, typeof body.importId === 'string' ? body.importId : '');
  if (body.action === 'process') return processMigration(user.id);
  return Response.json({ error: 'Невідома дія.' }, { status: 400 });
}

async function startMigration(userId: string, requestedImportId: string): Promise<Response> {
  const imported = requestedImportId
    ? await env.DB.prepare(`SELECT id, sha256, status FROM legacy_imports WHERE id = ?1 AND user_id = ?2 LIMIT 1`).bind(requestedImportId, userId).first<ImportRow>()
    : await env.DB.prepare(`SELECT id, sha256, status FROM legacy_imports WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1`).bind(userId).first<ImportRow>();
  if (!imported) return Response.json({ error: 'Підготовлену копію не знайдено.' }, { status: 404 });

  const existing = await env.DB.prepare(`SELECT id, import_id, status, phase, cursor, totals_json, processed_json, error_message FROM migration_jobs WHERE user_id = ?1 AND import_id = ?2 LIMIT 1`).bind(userId, imported.id).first<JobRow>();
  if (existing) {
    if (existing.status === 'failed') {
      await env.DB.prepare(`UPDATE migration_jobs SET status = 'running', error_message = NULL, updated_at = ?1 WHERE id = ?2 AND user_id = ?3`).bind(Math.floor(Date.now() / 1000), existing.id, userId).run();
      const resumed = await latestJob(userId);
      return Response.json({ job: resumed ? publicJob(resumed) : null });
    }
    return Response.json({ job: publicJob(existing) });
  }

  const raw = await readImportRaw(imported.id);
  if (await sha256Hex(raw) !== imported.sha256) return Response.json({ error: 'Цілісність копії порушена. Перенос зупинено.' }, { status: 409 });
  const dataset = buildLegacyMigrationDataset(raw, userId);
  const totals = migrationTotals(dataset);
  const jobId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO telegram_accounts (id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at) SELECT ?1,?2,1,'TG 1',1,1,?3,?3 WHERE NOT EXISTS (SELECT 1 FROM telegram_accounts WHERE user_id=?2)`).bind(`${userId}:tg1`,userId,now),
    env.DB.prepare(
    `INSERT INTO migration_jobs (id, user_id, import_id, status, phase, cursor, totals_json, processed_json, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'running', 'accounts', 0, ?4, '{}', ?5, ?5)`,
  ).bind(jobId, userId, imported.id, JSON.stringify(totals), now)];
  for (const phase of MIGRATION_PHASES) {
    const records = dataset[phase];
    for (let offset = 0; offset < records.length; offset += RECORDS_PER_STAGED_CHUNK) {
      const chunk = records.slice(offset, offset + RECORDS_PER_STAGED_CHUNK);
      statements.push(env.DB.prepare(
        `INSERT INTO migration_job_chunks (job_id, phase, chunk_index, record_count, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(jobId, phase, Math.floor(offset / RECORDS_PER_STAGED_CHUNK), chunk.length, JSON.stringify(chunk)));
    }
  }
  await env.DB.batch(statements);
  const job = await latestJob(userId);
  return Response.json({ job: job ? publicJob(job) : null });
}

async function processMigration(userId: string): Promise<Response> {
  const job = await latestJob(userId);
  if (!job) return Response.json({ error: 'Перенос ще не підготовлено.' }, { status: 404 });
  if (job.status === 'completed') return Response.json({ job: publicJob(job) });
  if (job.status !== 'running') return Response.json({ error: job.error_message || 'Перенос зупинено.' }, { status: 409 });

  try {
    const imported = await env.DB.prepare(`SELECT id, sha256, status FROM legacy_imports WHERE id = ?1 AND user_id = ?2 LIMIT 1`).bind(job.import_id, userId).first<ImportRow>();
    if (!imported) throw new Error('Підготовлену копію не знайдено.');
    const phase = job.phase as MigrationPhase;
    if (!MIGRATION_PHASES.includes(phase)) throw new Error('Невідомий етап переносу.');
    const totals = safeCountRecord(job.totals_json);
    const phaseTotal = totals[phase] || 0;
    const stagedChunkIndex = Math.floor(job.cursor / RECORDS_PER_STAGED_CHUNK);
    const stagedChunk = phaseTotal
      ? await env.DB.prepare(`SELECT payload_json FROM migration_job_chunks WHERE job_id = ?1 AND phase = ?2 AND chunk_index = ?3 LIMIT 1`).bind(job.id, phase, stagedChunkIndex).first<{ payload_json: string }>()
      : null;
    if (phaseTotal && !stagedChunk) throw new Error('Не знайдено підготовлену порцію даних.');
    const records = stagedChunk ? JSON.parse(stagedChunk.payload_json) as LegacyMigrationDataset[MigrationPhase] : [];
    const chunkOffset = job.cursor % RECORDS_PER_STAGED_CHUNK;
    const chunk = records.slice(chunkOffset, chunkOffset + RECORDS_PER_STEP);
    const statements: D1PreparedStatement[] = [];
    for (const record of chunk) {
      statements.push(...legacyLeadGuards(env.DB, phase, record, userId));
      statements.push(statementFor(phase, record, userId, imported.id));
    }
    const processed = safeCountRecord(job.processed_json);
    processed[phase] = Math.min(phaseTotal, job.cursor + chunk.length);
    const reachedEnd = job.cursor + chunk.length >= phaseTotal;
    const phaseIndex = MIGRATION_PHASES.indexOf(phase);
    const completed = reachedEnd && phaseIndex === MIGRATION_PHASES.length - 1;
    const nextPhase = reachedEnd && !completed ? MIGRATION_PHASES[phaseIndex + 1] : phase;
    const nextCursor = reachedEnd ? 0 : job.cursor + chunk.length;
    const now = Math.floor(Date.now() / 1000);
    if (reachedEnd && phase === 'accounts') {
      const selected = (chunk as LegacyMigrationDataset['accounts']).find((record) => record.selected);
      if (selected) {
        statements.push(env.DB.prepare(
          `UPDATE telegram_accounts SET is_selected=CASE WHEN id=?1 THEN 1 ELSE 0 END,updated_at=?2 WHERE user_id=?3`,
        ).bind(selected.id,now,userId));
      }
    }
    statements.push(env.DB.prepare(
      `UPDATE migration_jobs SET status = ?1, phase = ?2, cursor = ?3, processed_json = ?4,
       updated_at = ?5, completed_at = ?6 WHERE id = ?7 AND user_id = ?8`,
    ).bind(completed ? 'completed' : 'running', completed ? 'done' : nextPhase, nextCursor, JSON.stringify(processed), now, completed ? now : null, job.id, userId));
    if (completed) statements.push(env.DB.prepare(`UPDATE legacy_imports SET status = 'migrated', updated_at = ?1 WHERE id = ?2 AND user_id = ?3`).bind(now, imported.id, userId));
    await env.DB.batch(statements);
    const updated = await latestJob(userId);
    return Response.json({ job: updated ? publicJob(updated) : null });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Невідома помилка переносу.';
    await env.DB.prepare(`UPDATE migration_jobs SET status = 'failed', error_message = ?1, updated_at = ?2 WHERE id = ?3 AND user_id = ?4`).bind(message.slice(0, 500), Math.floor(Date.now() / 1000), job.id, userId).run();
    return Response.json({ error: message }, { status: 500 });
  }
}

function statementFor(phase: MigrationPhase, value: LegacyMigrationDataset[MigrationPhase][number], userId: string, importId: string): D1PreparedStatement {
  if (phase === 'accounts') {
    const row = value as LegacyMigrationDataset['accounts'][number];
    return env.DB.prepare(`INSERT INTO telegram_accounts (id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at) VALUES (?1,?2,?3,?4,1,0,?5,?6)
      ON CONFLICT(id) DO UPDATE SET account_number=excluded.account_number,name=excluded.name,is_enabled=1,updated_at=excluded.updated_at WHERE telegram_accounts.user_id=excluded.user_id`).bind(row.id,userId,row.number,row.name,row.createdAt,row.updatedAt);
  }
  if (phase === 'chats') {
    const row = value as LegacyMigrationDataset['chats'][number];
    const accountId=row.telegramAccountId||(row.platform==='telegram'&&row.workflowStatus!=='to_join'?`${userId}:tg1`:null);
    return env.DB.prepare(`INSERT INTO chats (id,user_id,platform,name,link,normalized_link,workflow_status,is_private,joined_at,processed_at,snoozed_until,archive_reason,archived_at,legacy_payload_json,source_import_id,created_at,updated_at,note,legacy_date,telegram_account_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)
      ON CONFLICT(id) DO UPDATE SET platform=excluded.platform,name=excluded.name,link=excluded.link,normalized_link=excluded.normalized_link,workflow_status=excluded.workflow_status,is_private=excluded.is_private,joined_at=excluded.joined_at,processed_at=excluded.processed_at,snoozed_until=excluded.snoozed_until,archive_reason=excluded.archive_reason,archived_at=excluded.archived_at,legacy_payload_json=excluded.legacy_payload_json,source_import_id=excluded.source_import_id,updated_at=excluded.updated_at,note=excluded.note,legacy_date=excluded.legacy_date,telegram_account_id=CASE WHEN ?21=1 THEN excluded.telegram_account_id ELSE chats.telegram_account_id END
      WHERE chats.user_id=excluded.user_id`).bind(row.id,userId,row.platform,row.name,row.link,row.normalizedLink,row.workflowStatus,row.isPrivate,row.joinedAt,row.processedAt,row.snoozedUntil,row.archiveReason,row.archivedAt,row.payloadJson,importId,row.createdAt,row.updatedAt,row.note,row.legacyDate,accountId,row.telegramAccountExplicit);
  }
  if (phase === 'profiles') {
    const row = value as LegacyMigrationDataset['profiles'][number];
    return env.DB.prepare(`INSERT INTO chat_profiles (chat_id,language,cadence,weekdays_json,directions_json,note,review_status,source,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
      ON CONFLICT(chat_id) DO UPDATE SET language=excluded.language,cadence=excluded.cadence,weekdays_json=excluded.weekdays_json,directions_json=excluded.directions_json,note=excluded.note,review_status=excluded.review_status,source=excluded.source,updated_at=excluded.updated_at`).bind(row.chatId,row.language,row.cadence,row.weekdaysJson,row.directionsJson,row.note,row.reviewStatus,row.source,row.updatedAt);
  }
  if (phase === 'publications') {
    const row = value as LegacyMigrationDataset['publications'][number];
    return env.DB.prepare(`INSERT INTO chat_publications (id,user_id,chat_id,published_on,published_at,source,source_key,created_at,telegram_account_id) VALUES (?1,?2,?3,?4,?5,'legacy',?6,?7,(SELECT telegram_account_id FROM chats WHERE id=?3))
      ON CONFLICT(id) DO UPDATE SET published_on=excluded.published_on,published_at=COALESCE(excluded.published_at,chat_publications.published_at),telegram_account_id=excluded.telegram_account_id WHERE chat_publications.user_id=excluded.user_id`).bind(row.id,userId,row.chatId,row.publishedOn,row.publishedAt,row.sourceKey,row.createdAt);
  }
  if (phase === 'leads') {
    const row = value as LegacyMigrationDataset['leads'][number];
    return env.DB.prepare(`INSERT INTO leads (id,user_id,legacy_id,name,phone,telegram_username,normalized_phone,normalized_telegram,platform,subject,source_chat_id,source_chat_link,note,needs_details,status,teacher_name,lesson_platform,meeting_link,is_student,age_group,response_date,booking_date,response_cancelled_at,response_cancelled_date,created_at,booked_at,archived_at,legacy_payload_json,source_import_id,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30)
      ON CONFLICT(id) DO UPDATE SET legacy_id=excluded.legacy_id,name=excluded.name,phone=excluded.phone,telegram_username=excluded.telegram_username,normalized_phone=excluded.normalized_phone,normalized_telegram=excluded.normalized_telegram,platform=excluded.platform,subject=excluded.subject,source_chat_id=excluded.source_chat_id,source_chat_link=excluded.source_chat_link,note=excluded.note,needs_details=excluded.needs_details,status=excluded.status,teacher_name=excluded.teacher_name,lesson_platform=excluded.lesson_platform,meeting_link=excluded.meeting_link,is_student=excluded.is_student,age_group=excluded.age_group,response_date=excluded.response_date,booking_date=excluded.booking_date,response_cancelled_at=excluded.response_cancelled_at,response_cancelled_date=excluded.response_cancelled_date,booked_at=excluded.booked_at,archived_at=excluded.archived_at,legacy_payload_json=excluded.legacy_payload_json,source_import_id=excluded.source_import_id,updated_at=excluded.updated_at
      WHERE leads.user_id=excluded.user_id`).bind(row.id,userId,row.legacyId,row.name,row.phone,row.telegramUsername,row.normalizedPhone,row.normalizedTelegram,row.platform,row.subject,row.sourceChatId,row.sourceChatLink,row.note,row.needsDetails,row.status,row.teacherName,row.lessonPlatform,row.meetingLink,row.isStudent,row.ageGroup,row.responseDate,row.bookingDate,row.responseCancelledAt,row.responseCancelledDate,row.createdAt,row.bookedAt,row.archivedAt,row.payloadJson,importId,row.updatedAt);
  }
  if (phase === 'students') {
    const row = value as LegacyMigrationDataset['students'][number];
    return env.DB.prepare(`INSERT INTO students (id,user_id,lead_id,legacy_id,name,surname,age_group,note,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
      ON CONFLICT(id) DO UPDATE SET lead_id=excluded.lead_id,legacy_id=excluded.legacy_id,name=excluded.name,surname=excluded.surname,age_group=excluded.age_group,note=excluded.note,updated_at=excluded.updated_at WHERE students.user_id=excluded.user_id`).bind(row.id,userId,row.leadId,row.legacyId,row.name,row.surname,row.ageGroup,row.note,row.createdAt,row.updatedAt);
  }
  if (phase === 'lessons') {
    const row = value as LegacyMigrationDataset['lessons'][number];
    return env.DB.prepare(`INSERT INTO lessons (id,user_id,lead_id,student_id,legacy_id,student_name,subject,teacher_name,lesson_date,lesson_time,lesson_platform,meeting_link,status,booking_date,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
      ON CONFLICT(id) DO UPDATE SET lead_id=excluded.lead_id,student_id=excluded.student_id,legacy_id=excluded.legacy_id,student_name=excluded.student_name,subject=excluded.subject,teacher_name=excluded.teacher_name,lesson_date=excluded.lesson_date,lesson_time=excluded.lesson_time,lesson_platform=excluded.lesson_platform,meeting_link=excluded.meeting_link,status=excluded.status,booking_date=excluded.booking_date,updated_at=excluded.updated_at WHERE lessons.user_id=excluded.user_id`).bind(row.id,userId,row.leadId,row.studentId,row.legacyId,row.studentName,row.subject,row.teacherName,row.lessonDate,row.lessonTime,row.lessonPlatform,row.meetingLink,row.status,row.bookingDate,row.createdAt,row.updatedAt);
  }
  if (phase === 'curatorRequests') {
    const row = value as LegacyMigrationDataset['curatorRequests'][number];
    return env.DB.prepare(`INSERT INTO curator_requests (id,user_id,lead_id,legacy_id,status,submitted_at,submitted_date,resolved_at,lesson_id,created_at,updated_at,source_import_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
      ON CONFLICT DO UPDATE SET status=excluded.status,submitted_at=excluded.submitted_at,submitted_date=excluded.submitted_date,resolved_at=excluded.resolved_at,lesson_id=excluded.lesson_id,updated_at=excluded.updated_at,source_import_id=excluded.source_import_id WHERE curator_requests.user_id=excluded.user_id`).bind(row.id,userId,row.leadId,row.legacyId,row.status,row.submittedAt,row.submittedDate,row.resolvedAt,row.lessonId,row.createdAt,row.updatedAt,importId);
  }
  if (phase === 'reports') {
    const row = value as LegacyMigrationDataset['reports'][number];
    return env.DB.prepare(`INSERT INTO daily_reports (id,user_id,report_date,report_text,payload_json,submitted_at,updated_at,source_import_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
      ON CONFLICT(id) DO UPDATE SET report_date=excluded.report_date,report_text=excluded.report_text,payload_json=excluded.payload_json,submitted_at=excluded.submitted_at,updated_at=excluded.updated_at,source_import_id=excluded.source_import_id WHERE daily_reports.user_id=excluded.user_id`).bind(row.id,userId,row.reportDate,row.reportText,row.payloadJson,row.submittedAt,row.updatedAt,importId);
  }
  if (phase === 'settings') {
    const row = value as LegacyMigrationDataset['settings'][number];
    return env.DB.prepare(`INSERT INTO user_settings (user_id,setting_key,value_json,source_import_id,updated_at) VALUES (?1,?2,?3,?4,?5)
      ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,source_import_id=excluded.source_import_id,updated_at=excluded.updated_at`).bind(userId,row.key,row.valueJson,importId,row.updatedAt);
  }
  const row = value as LegacyMigrationDataset['events'][number];
  const accountId=row.telegramAccountId;
  return env.DB.prepare(`INSERT INTO activity_events (id,user_id,event_type,platform,chat_id,lead_id,lesson_id,occurred_at,event_date,metadata_json,source_key,source_import_id,telegram_account_id,cancelled_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
    ON CONFLICT(user_id,source_key) DO UPDATE SET event_type=excluded.event_type,platform=excluded.platform,chat_id=excluded.chat_id,lead_id=excluded.lead_id,lesson_id=excluded.lesson_id,event_date=excluded.event_date,metadata_json=excluded.metadata_json,source_import_id=excluded.source_import_id,telegram_account_id=excluded.telegram_account_id,cancelled_at=excluded.cancelled_at`).bind(row.id,userId,row.eventType,row.platform,row.chatId,row.leadId,row.lessonId,row.occurredAt,row.eventDate,row.metadataJson,row.sourceKey,importId,accountId,row.cancelledAt);
}

async function readImportRaw(importId: string): Promise<string> {
  const chunks = await env.DB.prepare(`SELECT payload_chunk FROM legacy_import_chunks WHERE import_id = ?1 ORDER BY chunk_index ASC`).bind(importId).all<{ payload_chunk: string }>();
  return chunks.results.map((chunk) => chunk.payload_chunk).join('');
}
async function latestJob(userId: string): Promise<JobRow | null> {
  return env.DB.prepare(`SELECT id, import_id, status, phase, cursor, totals_json, processed_json, error_message FROM migration_jobs WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1`).bind(userId).first<JobRow>();
}
function publicJob(job: JobRow) {
  const totals = safeCountRecord(job.totals_json);
  const processed = safeCountRecord(job.processed_json);
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const complete = Object.values(processed).reduce((sum, value) => sum + value, 0);
  return { id: job.id, importId: job.import_id, status: job.status, phase: job.phase, totals, processed, total, complete, percent: total ? Math.round(complete / total * 100) : 100, error: job.error_message };
}
function safeCountRecord(value: string): Record<string, number> {
  try { const parsed = JSON.parse(value) as Record<string, unknown>; return Object.fromEntries(Object.entries(parsed).map(([key, count]) => [key, Number(count) || 0])); }
  catch { return {}; }
}

