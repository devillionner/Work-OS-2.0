import type { Attachment } from './domain/types.ts';
import { LeadError } from './domain/validation.ts';

export const MAX_LEAD_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const LEAD_ATTACHMENT_CHUNK_BYTES = 240_000;
export const MAX_LEAD_ATTACHMENT_CHUNKS = 64;

export type AttachmentView = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: number;
};

type MessageContext = {
  version: number;
  archivedAt: number | null;
};

type StoredAttachment = AttachmentView & {
  userId: string;
  leadId: string;
  messageId: string;
  sha256: string;
  chunkCount: number;
};

const DANGEROUS_EXTENSIONS = new Set([
  'bat','cmd','com','exe','hta','htm','html','jar','js','jse','lnk','msi','ps1','psm1','scr','svg','vbs','vbe','wsf',
]);
const ALLOWED_EXACT_TYPES = new Set([
  'application/octet-stream',
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);

export function attachmentView(attachment: Attachment): AttachmentView {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    createdAt: attachment.createdAt,
  };
}

export function validateAttachmentFile(input: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}) {
  const fileName = cleanFileName(input.fileName);
  const contentType = cleanContentType(input.contentType);
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1)
    throw new LeadError('Файл порожній або має некоректний розмір.');
  if (input.sizeBytes > MAX_LEAD_ATTACHMENT_BYTES)
    throw new LeadError('Файл завеликий. Максимум — 10 MB.', 413);
  const extension = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  if (DANGEROUS_EXTENSIONS.has(extension))
    throw new LeadError('Цей тип файлу не дозволений у CRM.');
  if (
    !contentType.startsWith('image/') &&
    !contentType.startsWith('audio/') &&
    !contentType.startsWith('video/') &&
    !ALLOWED_EXACT_TYPES.has(contentType)
  )
    throw new LeadError('Підтримуються зображення, аудіо, відео, PDF, текстові та офісні файли.');
  if (contentType === 'image/svg+xml' || contentType === 'text/html')
    throw new LeadError('Цей тип файлу не дозволений у CRM.');
  return { fileName, contentType };
}

export async function createLeadAttachment(
  db: D1Database,
  input: {
    userId: string;
    leadId: string;
    messageId: string;
    attachmentId: string;
    version: number;
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
  },
  now = Math.floor(Date.now() / 1000),
): Promise<{ attachment: AttachmentView; version: number }> {
  const attachmentId = safeId(input.attachmentId, 'ID вкладення');
  const leadId = safeId(input.leadId, 'Лід');
  const messageId = safeId(input.messageId, 'Повідомлення');
  const version = safeVersion(input.version);
  const { fileName, contentType } = validateAttachmentFile({
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.bytes.byteLength,
  });

  const context = await readMessageContext(db, input.userId, leadId, messageId);
  if (!context) throw new LeadError('Повідомлення не знайдено.', 404);
  if (context.archivedAt !== null)
    throw new LeadError('Спочатку відновіть ліда з архіву.', 409);
  const sha256 = await digestHex(input.bytes);

  const prior = await readStoredAttachment(db, input.userId, attachmentId);
  if (prior) {
    if (
      prior.leadId !== leadId ||
      prior.messageId !== messageId ||
      prior.fileName !== fileName ||
      prior.contentType !== contentType ||
      prior.sizeBytes !== input.bytes.byteLength ||
      prior.sha256 !== sha256
    )
      throw new LeadError('ID вкладення вже використано для іншого файлу.', 409);
    return {
      attachment: toView(prior),
      version: context.version,
    };
  }
  if (context.version !== version)
    throw new LeadError('Запис уже змінено. Оновіть картку.', 409);

  const chunks = splitBytes(input.bytes).map(bytesToBase64);
  if (!chunks.length || chunks.length > MAX_LEAD_ATTACHMENT_CHUNKS)
    throw new LeadError('Не вдалося безпечно розбити файл на частини.');

  const statements: D1PreparedStatement[] = [
    db
      .prepare('INSERT INTO lead_write_guards(lead_id,user_id,expected_version) VALUES(?1,?2,?3)')
      .bind(leadId, input.userId, version),
    db
      .prepare(`INSERT INTO lead_message_attachments(
        id,user_id,lead_id,message_id,file_name,content_type,size_bytes,sha256,chunk_count,created_at
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`)
      .bind(
        attachmentId,
        input.userId,
        leadId,
        messageId,
        fileName,
        contentType,
        input.bytes.byteLength,
        sha256,
        chunks.length,
        now,
      ),
    ...chunks.map((chunk, index) =>
      db
        .prepare(`INSERT INTO lead_message_attachment_chunks(
          id,attachment_id,user_id,chunk_index,data_base64
        ) VALUES(?1,?2,?3,?4,?5)`)
        .bind(`${attachmentId}:${index}`, attachmentId, input.userId, index, chunk),
    ),
    db
      .prepare(`UPDATE leads SET version=version+1,managed_at=?1,updated_at=?1
        WHERE id=?2 AND user_id=?3`)
      .bind(now, leadId, input.userId),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    const repeated = await readStoredAttachment(db, input.userId, attachmentId);
    if (
      repeated &&
      repeated.leadId === leadId &&
      repeated.messageId === messageId &&
      repeated.fileName === fileName &&
      repeated.contentType === contentType &&
      repeated.sizeBytes === input.bytes.byteLength &&
      repeated.sha256 === sha256
    ) {
      const fresh = await readMessageContext(db, input.userId, leadId, messageId);
      return { attachment: toView(repeated), version: fresh?.version ?? version + 1 };
    }
    throwAttachmentWriteError(error);
  }
  return {
    attachment: {
      id: attachmentId,
      fileName,
      contentType,
      sizeBytes: input.bytes.byteLength,
      createdAt: now,
    },
    version: version + 1,
  };
}

export async function deleteLeadAttachment(
  db: D1Database,
  input: {
    userId: string;
    leadId: string;
    messageId: string;
    attachmentId: string;
    version: number;
  },
  now = Math.floor(Date.now() / 1000),
): Promise<{ version: number }> {
  const leadId = safeId(input.leadId, 'Лід');
  const messageId = safeId(input.messageId, 'Повідомлення');
  const attachmentId = safeId(input.attachmentId, 'ID вкладення');
  const version = safeVersion(input.version);
  const context = await readMessageContext(db, input.userId, leadId, messageId);
  if (!context) throw new LeadError('Повідомлення не знайдено.', 404);
  if (context.archivedAt !== null)
    throw new LeadError('Спочатку відновіть ліда з архіву.', 409);
  const attachment = await readStoredAttachment(db, input.userId, attachmentId);
  if (!attachment || attachment.leadId !== leadId || attachment.messageId !== messageId)
    throw new LeadError('Вкладення не знайдено.', 404);
  if (context.version !== version)
    throw new LeadError('Запис уже змінено. Оновіть картку.', 409);

  try {
    await db.batch([
      db
        .prepare('INSERT INTO lead_write_guards(lead_id,user_id,expected_version) VALUES(?1,?2,?3)')
        .bind(leadId, input.userId, version),
      db
        .prepare('DELETE FROM lead_message_attachment_chunks WHERE attachment_id=?1 AND user_id=?2')
        .bind(attachmentId, input.userId),
      db
        .prepare(`DELETE FROM lead_message_attachments
          WHERE id=?1 AND user_id=?2 AND lead_id=?3 AND message_id=?4`)
        .bind(attachmentId, input.userId, leadId, messageId),
      db
        .prepare(`UPDATE leads SET version=version+1,managed_at=?1,updated_at=?1
          WHERE id=?2 AND user_id=?3`)
        .bind(now, leadId, input.userId),
    ]);
  } catch (error) {
    throwAttachmentWriteError(error);
  }
  return { version: version + 1 };
}

export async function readLeadAttachment(
  db: D1Database,
  userId: string,
  attachmentIdRaw: string,
): Promise<{ attachment: AttachmentView; bytes: Uint8Array } | null> {
  const attachmentId = safeId(attachmentIdRaw, 'ID вкладення');
  const [metadataResult, chunksResult] = await db.batch([
    db
      .prepare(`SELECT a.id,a.file_name AS fileName,a.content_type AS contentType,
        a.size_bytes AS sizeBytes,a.chunk_count AS chunkCount,a.created_at AS createdAt
        FROM lead_message_attachments a
        INNER JOIN leads l ON l.id=a.lead_id AND l.user_id=a.user_id
        INNER JOIN lead_messages m ON m.id=a.message_id AND m.lead_id=a.lead_id AND m.user_id=a.user_id
        WHERE a.id=?1 AND a.user_id=?2 AND m.deleted_at IS NULL LIMIT 1`)
      .bind(attachmentId, userId),
    db
      .prepare(`SELECT chunk_index AS chunkIndex,data_base64 AS dataBase64
        FROM lead_message_attachment_chunks
        WHERE attachment_id=?1 AND user_id=?2 ORDER BY chunk_index`)
      .bind(attachmentId, userId),
  ]);
  const metadata = metadataResult.results[0] as
    | (AttachmentView & { chunkCount: number })
    | undefined;
  if (!metadata) return null;
  const chunks = chunksResult.results as Array<{ chunkIndex: number; dataBase64: string }>;
  if (chunks.length !== Number(metadata.chunkCount))
    throw new LeadError('Файл пошкоджений: кількість частин не збігається.', 500);
  const parts = chunks.map((chunk, index) => {
    if (Number(chunk.chunkIndex) !== index)
      throw new LeadError('Файл пошкоджений: порушено порядок частин.', 500);
    return base64ToBytes(chunk.dataBase64);
  });
  const bytes = joinBytes(parts);
  if (bytes.byteLength !== Number(metadata.sizeBytes))
    throw new LeadError('Файл пошкоджений: розмір не збігається.', 500);
  return {
    attachment: {
      id: metadata.id,
      fileName: metadata.fileName,
      contentType: metadata.contentType,
      sizeBytes: Number(metadata.sizeBytes),
      createdAt: Number(metadata.createdAt),
    },
    bytes,
  };
}

async function digestHex(bytes: Uint8Array) {
  const digestInput = bytes.slice().buffer as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

function splitBytes(bytes: Uint8Array) {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += LEAD_ATTACHMENT_CHUNK_BYTES)
    chunks.push(bytes.subarray(offset, Math.min(bytes.byteLength, offset + LEAD_ATTACHMENT_CHUNK_BYTES)));
  return chunks;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const step = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += step)
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.byteLength, offset + step)));
  return btoa(binary);
}

function base64ToBytes(value: string) {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new LeadError('Файл пошкоджений: некоректне кодування.', 500);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function joinBytes(parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

async function readMessageContext(
  db: D1Database,
  userId: string,
  leadId: string,
  messageId: string,
): Promise<MessageContext | null> {
  const row = await db
    .prepare(`SELECT l.version AS version,l.archived_at AS archivedAt
      FROM leads l
      INNER JOIN lead_messages m ON m.lead_id=l.id AND m.user_id=l.user_id
      WHERE l.id=?1 AND l.user_id=?2 AND m.id=?3 AND m.deleted_at IS NULL LIMIT 1`)
    .bind(leadId, userId, messageId)
    .first<MessageContext>();
  return row
    ? { version: Number(row.version), archivedAt: row.archivedAt === null ? null : Number(row.archivedAt) }
    : null;
}

async function readStoredAttachment(
  db: D1Database,
  userId: string,
  attachmentId: string,
): Promise<StoredAttachment | null> {
  const row = await db
    .prepare(`SELECT id,user_id AS userId,lead_id AS leadId,message_id AS messageId,
      file_name AS fileName,content_type AS contentType,size_bytes AS sizeBytes,
      sha256,chunk_count AS chunkCount,created_at AS createdAt
      FROM lead_message_attachments WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(attachmentId, userId)
    .first<StoredAttachment>();
  return row
    ? {
        ...row,
        sizeBytes: Number(row.sizeBytes),
        chunkCount: Number(row.chunkCount),
        createdAt: Number(row.createdAt),
      }
    : null;
}

function toView(attachment: StoredAttachment): AttachmentView {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    createdAt: attachment.createdAt,
  };
}

function safeId(value: unknown, label: string) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 || !/^[a-zA-Z0-9:_-]+$/.test(value))
    throw new LeadError(`Некоректне значення: ${label}.`);
  return value;
}

function safeVersion(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new LeadError('Некоректна версія картки.');
  return Number(value);
}

function cleanFileName(value: string) {
  const clean = Array.from(
    value.replaceAll('\\', '/').split('/').pop()!,
  )
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim()
    .replace(/\s+/g, ' ');
  if (!clean || clean.length > 180) throw new LeadError('Назва файлу має бути від 1 до 180 символів.');
  return clean;
}

function cleanContentType(value: string) {
  const clean = (value || 'application/octet-stream').trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(clean) || clean.length > 160)
    throw new LeadError('Некоректний тип файлу.');
  return clean;
}

function throwAttachmentWriteError(error: unknown): never {
  const message = String(error) + String(error instanceof Error ? error.cause : '');
  if (/lead_version_conflict/.test(message))
    throw new LeadError('Запис змінено на іншому пристрої. Оновіть картку.', 409);
  if (/UNIQUE constraint/.test(message))
    throw new LeadError('Вкладення вже змінено. Оновіть картку.', 409);
  throw error;
}
