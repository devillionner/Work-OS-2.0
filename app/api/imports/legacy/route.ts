import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import {
  analyzeLegacyBackup,
  inspectLegacyBackup,
  LEGACY_BACKUP_MAX_BYTES,
  sha256Hex,
} from '@/lib/legacy-backup';
import { buildLegacyMigrationDataset } from '@/lib/legacy-migration';

const REQUEST_MAX_BYTES = Math.ceil(LEGACY_BACKUP_MAX_BYTES * 1.4);
const CHUNK_SIZE = 300_000;

type ImportRequest = {
  filename?: unknown;
  rawBackup?: unknown;
  sha256?: unknown;
};

type StagedImportRow = {
  id: string;
  original_filename: string;
  sha256: string;
  byte_size: number;
  status: string;
  summary_json: string;
  created_at: number;
};

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });

  const staged = await env.DB.prepare(
    `SELECT id, original_filename, sha256, byte_size, status, summary_json, created_at
     FROM legacy_imports WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1`,
  ).bind(user.id).first<StagedImportRow>();
  if (!staged) return Response.json({ staged: null });

  return Response.json({ staged: await describeStagedImport(staged, user.id) });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) {
    return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > REQUEST_MAX_BYTES) return tooLarge();

  const requestText = await request.text();
  if (new TextEncoder().encode(requestText).byteLength > REQUEST_MAX_BYTES) {
    return tooLarge();
  }

  let body: ImportRequest;
  try {
    body = JSON.parse(requestText) as ImportRequest;
  } catch {
    return Response.json({ error: 'Не вдалося прочитати запит.' }, { status: 400 });
  }

  if (typeof body.rawBackup !== 'string') {
    return Response.json({ error: 'Резервну копію не передано.' }, { status: 400 });
  }
  const backupBytes = new TextEncoder().encode(body.rawBackup).byteLength;
  if (backupBytes > LEGACY_BACKUP_MAX_BYTES) return tooLarge();

  const inspection = inspectLegacyBackup(body.rawBackup);
  if (!inspection.valid || inspection.schemaVersion === null) {
    return Response.json(
      { error: inspection.errors[0] || 'Копія не пройшла перевірку.' },
      { status: 400 },
    );
  }

  const serverHash = await sha256Hex(body.rawBackup);
  if (typeof body.sha256 === 'string' && body.sha256 !== serverHash) {
    return Response.json(
      { error: 'Файл змінився під час завантаження. Спробуй ще раз.' },
      { status: 409 },
    );
  }

  const existing = await env.DB.prepare(
    `SELECT id, summary_json FROM legacy_imports
     WHERE user_id = ?1 AND sha256 = ?2 LIMIT 1`,
  )
    .bind(user.id, serverHash)
    .first<{ id: string; summary_json: string }>();

  if (existing) {
    const staged = await env.DB.prepare(
      `SELECT id, original_filename, sha256, byte_size, status, summary_json, created_at
       FROM legacy_imports WHERE id = ?1 LIMIT 1`,
    ).bind(existing.id).first<StagedImportRow>();
    return Response.json({
      ok: true,
      duplicate: true,
      importId: existing.id,
      summary: JSON.parse(existing.summary_json),
      staged: staged ? await describeStagedImport(staged, user.id) : null,
    });
  }

  const importId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const filename = safeFilename(body.filename);
  const chunks = chunkString(body.rawBackup, CHUNK_SIZE);
  const statements = [
    env.DB.prepare(
      `INSERT INTO legacy_imports
       (id, user_id, original_filename, sha256, source_schema_version,
        byte_size, status, summary_json, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'staged', ?7, ?8, ?8)`,
    ).bind(
      importId,
      user.id,
      filename,
      serverHash,
      inspection.schemaVersion,
      backupBytes,
      JSON.stringify(inspection.summary),
      now,
    ),
    ...chunks.map((chunk, index) =>
      env.DB.prepare(
        `INSERT INTO legacy_import_chunks (import_id, chunk_index, payload_chunk)
         VALUES (?1, ?2, ?3)`,
      ).bind(importId, index, chunk),
    ),
  ];

  await env.DB.batch(statements);

  return Response.json({
    ok: true,
    duplicate: false,
    importId,
    summary: inspection.summary,
      staged: {
      id: importId,
      filename,
      sha256: serverHash,
      byteSize: backupBytes,
      status: 'staged',
      createdAt: now,
      integrityOk: true,
      summary: inspection.summary,
        analysis: analyzeLegacyBackup(body.rawBackup),
        syncPreview: await buildSyncPreview(body.rawBackup, user.id),
    },
  });
}

async function describeStagedImport(staged: StagedImportRow, userId: string) {
  const chunks = await env.DB.prepare(
    `SELECT payload_chunk FROM legacy_import_chunks
     WHERE import_id = ?1 ORDER BY chunk_index ASC`,
  ).bind(staged.id).all<{ payload_chunk: string }>();
  const raw = chunks.results.map((chunk) => chunk.payload_chunk).join('');
  const calculatedHash = await sha256Hex(raw);
  return {
    id: staged.id,
    filename: staged.original_filename,
    sha256: staged.sha256,
    byteSize: staged.byte_size,
    status: staged.status,
    createdAt: staged.created_at,
    integrityOk: calculatedHash === staged.sha256,
    summary: JSON.parse(staged.summary_json),
    analysis: analyzeLegacyBackup(raw),
    syncPreview: await buildSyncPreview(raw, userId),
  };
}

async function buildSyncPreview(raw: string, userId: string) {
  const dataset = buildLegacyMigrationDataset(raw, userId);
  const [accounts, chats, publications, leads, lessons, reports] = await env.DB.batch([
    env.DB.prepare(`SELECT id FROM telegram_accounts WHERE user_id=?1`).bind(userId),
    env.DB.prepare(`SELECT id FROM chats WHERE user_id=?1`).bind(userId),
    env.DB.prepare(`SELECT id FROM chat_publications WHERE user_id=?1`).bind(userId),
    env.DB.prepare(`SELECT id FROM leads WHERE user_id=?1`).bind(userId),
    env.DB.prepare(`SELECT id FROM lessons WHERE user_id=?1`).bind(userId),
    env.DB.prepare(`SELECT id FROM daily_reports WHERE user_id=?1`).bind(userId),
  ]);
  const categories = {
    accounts: compareIds(dataset.accounts, accounts.results),
    chats: compareIds(dataset.chats, chats.results),
    publications: compareIds(dataset.publications, publications.results),
    leads: compareIds(dataset.leads, leads.results),
    lessons: compareIds(dataset.lessons, lessons.results),
    reports: compareIds(dataset.reports, reports.results),
  };
  return {
    categories,
    added: Object.values(categories).reduce((sum, item) => sum + item.added, 0),
    matched: Object.values(categories).reduce((sum, item) => sum + item.matched, 0),
    preserved: Object.values(categories).reduce((sum, item) => sum + item.preserved, 0),
  };
}

function compareIds(source: Array<{id:string}>, existingRows: unknown[]) {
  const existing = new Set((existingRows as Array<{id:string}>).map((row) => row.id));
  const sourceIds = new Set(source.map((row) => row.id));
  let matched = 0;
  for (const id of sourceIds) if (existing.has(id)) matched += 1;
  return { total: sourceIds.size, added: sourceIds.size - matched, matched, preserved: existing.size - matched };
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}

function tooLarge(): Response {
  return Response.json(
    { error: 'Файл завеликий. Максимальний розмір — 10 МБ.' },
    { status: 413 },
  );
}

function safeFilename(value: unknown): string {
  const filename = typeof value === 'string' ? value.trim() : '';
  return Array.from(filename || 'prototype-checker-backup.json')
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || '\\/:*?"<>|'.includes(character) ? '_' : character;
    })
    .join('')
    .slice(0, 180);
}

function chunkString(value: string, size: number): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(offset + size, value.length);
    if (
      end < value.length &&
      isHighSurrogate(value.charCodeAt(end - 1)) &&
      isLowSurrogate(value.charCodeAt(end))
    ) {
      end -= 1;
    }
    chunks.push(value.slice(offset, end));
    offset = end;
  }
  return chunks.length ? chunks : [''];
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
