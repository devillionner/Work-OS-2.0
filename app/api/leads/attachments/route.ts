import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { commandBody, errorResponse, json } from '@/lib/leads/application/http';
import { readBoundedMultipartForm } from '@/lib/http-form';
import {
  MAX_LEAD_ATTACHMENT_BYTES,
  createLeadAttachment,
  deleteLeadAttachment,
  readLeadAttachment,
} from '@/lib/leads/attachments';
import { LeadError } from '@/lib/leads/domain/validation';

const MAX_MULTIPART_OVERHEAD = 1024 * 1024;
const MAX_MULTIPART_BYTES =
  MAX_LEAD_ATTACHMENT_BYTES + MAX_MULTIPART_OVERHEAD;

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ error: 'Потрібно увійти.' }, 401);
    const id = new URL(request.url).searchParams.get('id')?.trim() ?? '';
    if (!id) throw new LeadError('Вкладення не знайдено.', 404);
    const stored = await readLeadAttachment(env.DB, user.id, id);
    if (!stored) throw new LeadError('Вкладення не знайдено.', 404);
    const inline = isSafeInlineType(stored.attachment.contentType);
    const body = stored.bytes.slice().buffer as ArrayBuffer;
    return new Response(body, {
      headers: {
        'Content-Type': stored.attachment.contentType,
        'Content-Length': String(stored.bytes.byteLength),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(stored.attachment.fileName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ error: 'Потрібно увійти.' }, 401);
    assertSameOrigin(request);

    const form = await readBoundedMultipartForm(request, MAX_MULTIPART_BYTES);
    if (form instanceof Response) return form;

    const file = form.get('file');
    if (!(file instanceof File)) throw new LeadError('Оберіть файл.');
    const result = await createLeadAttachment(
      env.DB,
      {
        userId: user.id,
        leadId: formText(form, 'leadId'),
        messageId: formText(form, 'messageId'),
        attachmentId: formText(form, 'attachmentId'),
        version: formInteger(form, 'version'),
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
    );
    return json(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ error: 'Потрібно увійти.' }, 401);
    const raw = await commandBody(request);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new LeadError('Некоректний запит.');
    const body = raw as Record<string, unknown>;
    const result = await deleteLeadAttachment(env.DB, {
      userId: user.id,
      leadId: stringField(body.leadId, 'Лід'),
      messageId: stringField(body.messageId, 'Повідомлення'),
      attachmentId: stringField(body.attachmentId, 'ID вкладення'),
      version: integerField(body.version, 'Версія картки'),
    });
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

function assertSameOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    throw new LeadError('Недійсне джерело запиту.', 403);
}

function formText(form: FormData, key: string) {
  const value = form.get(key);
  if (typeof value !== 'string') throw new LeadError(`Відсутнє поле: ${key}.`);
  return value.trim();
}

function formInteger(form: FormData, key: string) {
  const value = formText(form, key);
  if (!/^\d+$/.test(value)) throw new LeadError(`Некоректне поле: ${key}.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new LeadError(`Некоректне поле: ${key}.`);
  return number;
}

function stringField(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim())
    throw new LeadError(`Некоректне значення: ${label}.`);
  return value.trim();
}

function integerField(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new LeadError(`Некоректне значення: ${label}.`);
  return Number(value);
}

function isSafeInlineType(contentType: string) {
  return [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
  ].includes(contentType);
}
