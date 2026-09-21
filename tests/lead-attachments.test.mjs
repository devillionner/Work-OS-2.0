import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema.ts';
import { D1LeadRepository } from '../lib/leads/data/repository.ts';
import { executeLeadCommand } from '../lib/leads/application/service.ts';
import { leadDetail } from '../lib/leads/application/queries.ts';
import {
  createLeadAttachment,
  deleteLeadAttachment,
  readLeadAttachment,
} from '../lib/leads/attachments.ts';
import { prepareConversationExport } from '../lib/leads/application/conversation-export.ts';
import { backupManifest, backupPage } from '../lib/backups/export.ts';
import { localDatabase } from './helpers/local-d1.mjs';

const NOW = Math.floor(Date.parse('2026-09-21T10:00:00Z') / 1000);

async function fixture(t) {
  const db = await localDatabase(t);
  const repo = new D1LeadRepository(drizzle(db, { schema }));
  const leadId = await executeLeadCommand(
    repo,
    'u',
    {
      commandId: crypto.randomUUID(),
      version: 0,
      action: 'create',
      data: {
        name: 'Media lead',
        subject: 'English',
        responseDate: '2026-09-21',
      },
    },
    NOW,
  );
  let aggregate = await repo.load('u', leadId);
  await executeLeadCommand(
    repo,
    'u',
    {
      commandId: crypto.randomUUID(),
      version: aggregate.lead.version,
      action: 'message_create',
      leadId,
      data: { sender: 'lead', body: 'Фото з переписки', sentAt: NOW - 10 },
    },
    NOW,
  );
  aggregate = await repo.load('u', leadId);
  return {
    db,
    repo,
    leadId,
    messageId: aggregate.messages[0].id,
    version: aggregate.lead.version,
  };
}

function bytes(size, seed = 17) {
  const value = new Uint8Array(size);
  for (let index = 0; index < value.length; index += 1)
    value[index] = (seed + index * 31) % 256;
  return value;
}

void test('lead attachment upload is chunked, owner scoped, idempotent and visible in CRM history', async (t) => {
  const f = await fixture(t);
  const payload = bytes(600_123);
  const created = await createLeadAttachment(
    f.db,
    {
      userId: 'u',
      leadId: f.leadId,
      messageId: f.messageId,
      attachmentId: 'attachment-1',
      version: f.version,
      fileName: ' proof.png ',
      contentType: 'image/png',
      bytes: payload,
    },
    NOW,
  );
  assert.equal(created.version, f.version + 1);
  assert.equal(created.attachment.fileName, 'proof.png');
  assert.equal(created.attachment.sizeBytes, payload.length);

  const stored = await readLeadAttachment(f.db, 'u', 'attachment-1');
  assert.ok(stored);
  assert.equal(stored.bytes.length, payload.length);
  assert.equal(stored.bytes[0], payload[0]);
  assert.equal(stored.bytes[240_000], payload[240_000]);
  assert.equal(stored.bytes.at(-1), payload.at(-1));
  assert.equal(await readLeadAttachment(f.db, 'other', 'attachment-1'), null);

  const chunks = await f.db
    .prepare(`SELECT chunk_index AS chunkIndex,length(data_base64) AS encodedLength
      FROM lead_message_attachment_chunks
      WHERE attachment_id='attachment-1' ORDER BY chunk_index`)
    .all();
  assert.equal(chunks.results.length, 3);
  assert.ok(chunks.results.every((row) => Number(row.encodedLength) <= 350_000));

  const aggregate = await f.repo.load('u', f.leadId, { messageLimit: 30 });
  const detail = leadDetail(aggregate, NOW);
  assert.equal(detail.messages[0].attachments.length, 1);
  assert.equal(detail.messages[0].attachments[0].fileName, 'proof.png');

  const retry = await createLeadAttachment(
    f.db,
    {
      userId: 'u',
      leadId: f.leadId,
      messageId: f.messageId,
      attachmentId: 'attachment-1',
      version: f.version,
      fileName: 'proof.png',
      contentType: 'image/png',
      bytes: payload,
    },
    NOW,
  );
  assert.equal(retry.version, f.version + 1);
  assert.equal(
    Number(
      (
        await f.db
          .prepare("SELECT count(*) n FROM lead_message_attachments WHERE id='attachment-1'")
          .first()
      ).n,
    ),
    1,
  );

  await assert.rejects(
    createLeadAttachment(f.db, {
      userId: 'u',
      leadId: f.leadId,
      messageId: f.messageId,
      attachmentId: 'attachment-1',
      version: f.version + 1,
      fileName: 'proof.png',
      contentType: 'image/png',
      bytes: bytes(payload.length, 99),
    }),
    /іншого файлу/,
  );
  await assert.rejects(
    createLeadAttachment(f.db, {
      userId: 'other',
      leadId: f.leadId,
      messageId: f.messageId,
      attachmentId: 'foreign-attachment',
      version: f.version + 1,
      fileName: 'foreign.png',
      contentType: 'image/png',
      bytes: bytes(10),
    }),
    /Повідомлення не знайдено/,
  );
  await assert.rejects(
    createLeadAttachment(f.db, {
      userId: 'u',
      leadId: f.leadId,
      messageId: f.messageId,
      attachmentId: 'stale-attachment',
      version: f.version,
      fileName: 'stale.pdf',
      contentType: 'application/pdf',
      bytes: bytes(20),
    }),
    /Запис уже змінено/,
  );
});

void test('attachment delete bumps the lead version and removes binary chunks', async (t) => {
  const f = await fixture(t);
  const created = await createLeadAttachment(f.db, {
    userId: 'u',
    leadId: f.leadId,
    messageId: f.messageId,
    attachmentId: 'delete-me',
    version: f.version,
    fileName: 'voice.mp3',
    contentType: 'audio/mpeg',
    bytes: bytes(300_001),
  });
  const removed = await deleteLeadAttachment(f.db, {
    userId: 'u',
    leadId: f.leadId,
    messageId: f.messageId,
    attachmentId: 'delete-me',
    version: created.version,
  });
  assert.equal(removed.version, created.version + 1);
  assert.equal(await readLeadAttachment(f.db, 'u', 'delete-me'), null);
  assert.equal(
    Number(
      (
        await f.db
          .prepare("SELECT count(*) n FROM lead_message_attachment_chunks WHERE attachment_id='delete-me'")
          .first()
      ).n,
    ),
    0,
  );
});

void test('soft deleting a CRM message also removes its media instead of leaving hidden backup data', async (t) => {
  const f = await fixture(t);
  const created = await createLeadAttachment(f.db, {
    userId: 'u',
    leadId: f.leadId,
    messageId: f.messageId,
    attachmentId: 'message-media',
    version: f.version,
    fileName: 'scan.pdf',
    contentType: 'application/pdf',
    bytes: bytes(40_000),
  });
  await executeLeadCommand(
    f.repo,
    'u',
    {
      commandId: crypto.randomUUID(),
      version: created.version,
      action: 'message_delete',
      leadId: f.leadId,
      entityId: f.messageId,
      data: {},
    },
    NOW + 1,
  );
  assert.equal(await readLeadAttachment(f.db, 'u', 'message-media'), null);
  assert.equal(
    Number(
      (
        await f.db
          .prepare("SELECT count(*) n FROM lead_message_attachments WHERE id='message-media'")
          .first()
      ).n,
    ),
    0,
  );
  assert.equal(
    Number(
      (
        await f.db
          .prepare("SELECT count(*) n FROM lead_message_attachment_chunks WHERE attachment_id='message-media'")
          .first()
      ).n,
    ),
    0,
  );
});

void test('conversation export and cloud backup include attachment metadata and bounded chunks', async (t) => {
  const f = await fixture(t);
  const created = await createLeadAttachment(f.db, {
    userId: 'u',
    leadId: f.leadId,
    messageId: f.messageId,
    attachmentId: 'backup-media',
    version: f.version,
    fileName: 'photo.webp',
    contentType: 'image/webp',
    bytes: bytes(500_000),
  });
  assert.equal(created.version, f.version + 1);

  const prepared = await prepareConversationExport(f.db, 'u', f.leadId);
  assert.ok(prepared);
  const text = await new Response(prepared.stream).text();
  assert.match(text, /Вкладення: photo\.webp \(image\/webp, 500000 B\)/);

  const manifest = await backupManifest(f.db, 'u');
  assert.equal(manifest.counts.lead_message_attachments, 1);
  assert.equal(manifest.counts.lead_message_attachment_chunks, 3);
  const metadataPage = await backupPage(
    f.db,
    'u',
    'lead_message_attachments',
    '',
    manifest.revision,
  );
  assert.equal(metadataPage.rows.length, 1);
  assert.equal(metadataPage.rows[0].id, 'backup-media');
  assert.equal(String(metadataPage.rows[0].sha256).length, 64);

  const firstChunk = await backupPage(
    f.db,
    'u',
    'lead_message_attachment_chunks',
    '',
    manifest.revision,
  );
  assert.equal(firstChunk.rows.length, 1);
  assert.ok(String(firstChunk.rows[0].data_base64).length <= 350_000);
  assert.notEqual(firstChunk.nextCursor, null);
});

void test('attachment validation blocks executable and active-content payloads', async (t) => {
  const f = await fixture(t);
  for (const candidate of [
    { fileName: 'run.exe', contentType: 'application/octet-stream' },
    { fileName: 'vector.svg', contentType: 'image/svg+xml' },
    { fileName: 'page.html', contentType: 'text/html' },
  ]) {
    await assert.rejects(
      createLeadAttachment(f.db, {
        userId: 'u',
        leadId: f.leadId,
        messageId: f.messageId,
        attachmentId: crypto.randomUUID(),
        version: f.version,
        fileName: candidate.fileName,
        contentType: candidate.contentType,
        bytes: bytes(12),
      }),
      /не дозволен|Підтримуються/,
    );
  }
});
