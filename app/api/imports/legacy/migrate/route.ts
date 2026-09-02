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

const RECORDS_PER_STEP = 30;
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

  const body = await request.json().catch(() => ({})) as { action?: unknown; importId?: unknown };
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
  const statements: D1PreparedStatement[] = [env.DB.prepare(
    `INSERT INTO migration_jobs (id, user_id, import_id, status, phase, cursor, totals_json, processed_json, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'running', 'chats', 0, ?4, '{}', ?5, ?5)`,
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
    const statements = chunk.map((record) => statementFor(phase, record, userId, imported.id));
    const processed = safeCountRecord(job.processed_json);
    processed[phase] = Math.min(phaseTotal, job.cursor + chunk.length);
    const reachedEnd = job.cursor + chunk.length >= phaseTotal;
    const phaseIndex = MIGRATION_PHASES.indexOf(phase);
    const completed = reachedEnd && phaseIndex === MIGRATION_PHASES.length - 1;
    const nextPhase = reachedEnd && !completed ? MIGRATION_PHASES[phaseIndex + 1] : phase;
    const nextCursor = reachedEnd ? 0 : job.cursor + chunk.length;
    const now = Math.floor(Date.now() / 1000);
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
  if (phase === 'chats') {
    const row = value as LegacyMigrationDataset['chats'][number];
    return env.DB.prepare(`INSERT OR IGNORE INTO chats (id,user_id,platform,name,link,normalized_link,workflow_status,is_private,joined_at,processed_at,snoozed_until,archive_reason,archived_at,legacy_payload_json,source_import_id,created_at,updated_at,note,legacy_date) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)`).bind(row.id,userId,row.platform,row.name,row.link,row.normalizedLink,row.workflowStatus,row.isPrivate,row.joinedAt,row.processedAt,row.snoozedUntil,row.archiveReason,row.archivedAt,row.payloadJson,importId,row.createdAt,row.updatedAt,row.note,row.legacyDate);
  }
  if (phase === 'profiles') {
    const row = value as LegacyMigrationDataset['profiles'][number];
    return env.DB.prepare(`INSERT OR IGNORE INTO chat_profiles (chat_id,language,cadence,weekdays_json,directions_json,note,review_status,source,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`).bind(row.chatId,row.language,row.cadence,row.weekdaysJson,row.directionsJson,row.note,row.reviewStatus,row.source,row.updatedAt);
  }
  if (phase === 'publications') {
    const row = value as LegacyMigrationDataset['publications'][number];
    return env.DB.prepare(`INSERT OR IGNORE INTO chat_publications (id,user_id,chat_id,published_on,published_at,source,source_key,created_at) VALUES (?1,?2,?3,?4,?5,'legacy',?6,?7)`).bind(row.id,userId,row.chatId,row.publishedOn,row.publishedAt,row.sourceKey,row.createdAt);
  }
  if (phase === 'leads') {
    const row = value as LegacyMigrationDataset['leads'][number];
    return env.DB.prepare(`INSERT OR IGNORE INTO leads (id,user_id,legacy_id,name,phone,telegram_username,normalized_phone,normalized_telegram,platform,source_chat_id,source_chat_link,note,needs_details,status,teacher_name,lesson_platform,meeting_link,is_student,age_group,created_at,booked_at,archived_at,legacy_payload_json,source_import_id,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)`).bind(row.id,userId,row.legacyId,row.name,row.phone,row.telegramUsername,row.normalizedPhone,row.normalizedTelegram,row.platform,row.sourceChatId,row.sourceChatLink,row.note,row.needsDetails,row.status,row.teacherName,row.lessonPlatform,row.meetingLink,row.isStudent,row.ageGroup,row.createdAt,row.bookedAt,row.archivedAt,row.payloadJson,importId,row.updatedAt);
  }
  if (phase === 'students') {
    const row = value as LegacyMigrationDataset['students'][number];
    return env.DB.prepare(`INSERT OR IGNORE INTO students (id,user_id,lead_id,legacy_id,name,surname,age_group,note,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`).bind(row.id,userId,row.leadId,row.legacyId,row.name,row.surname,row.ageGroup,row.note,row.createdAt,row.updatedAt);
  }
  if (phase === 'lessons') {
    const row = value as LegacyMigrationDataset['lessons'][number];
    return env.DB.prepare(`INSERT OR IGNORE INTO lessons (id,user_id,lead_id,student_id,legacy_id,student_name,subject,teacher_name,lesson_date,lesson_time,lesson_platform,meeting_link,status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`).bind(row.id,userId,row.leadId,row.studentId,row.legacyId,row.studentName,row.subject,row.teacherName,row.lessonDate,row.lessonTime,row.lessonPlatform,row.meetingLink,row.status,row.createdAt,row.updatedAt);
  }
  if (phase === 'reports') {
    const row = value as LegacyMigrationDataset['reports'][number];
    return env.DB.prepare(`INSERT OR IGNORE INTO daily_reports (id,user_id,report_date,report_text,payload_json,submitted_at,updated_at,source_import_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`).bind(row.id,userId,row.reportDate,row.reportText,row.payloadJson,row.submittedAt,row.updatedAt,importId);
  }
  if (phase === 'settings') {
    const row = value as LegacyMigrationDataset['settings'][number];
    return env.DB.prepare(`INSERT OR IGNORE INTO user_settings (user_id,setting_key,value_json,source_import_id,updated_at) VALUES (?1,?2,?3,?4,?5)`).bind(userId,row.key,row.valueJson,importId,row.updatedAt);
  }
  const row = value as LegacyMigrationDataset['events'][number];
  return env.DB.prepare(`INSERT OR IGNORE INTO activity_events (id,user_id,event_type,platform,chat_id,lead_id,lesson_id,occurred_at,event_date,metadata_json,source_key,source_import_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`).bind(row.id,userId,row.eventType,row.platform,row.chatId,row.leadId,row.lessonId,row.occurredAt,row.eventDate,row.metadataJson,row.sourceKey,importId);
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
function sameOrigin(request: Request): boolean { const origin = request.headers.get('origin'); return Boolean(origin && origin === new URL(request.url).origin); }
