import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/db';
import { D1LeadRepository } from '@/lib/leads/data/repository';
import type { MessageCursor } from '@/lib/leads/domain/types';
import { errorResponse, json } from '@/lib/leads/application/http';
import { LeadError } from '@/lib/leads/domain/validation';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

function safeInteger(value: string | null, label: string) {
  if (value === null || !/^\d+$/.test(value))
    throw new LeadError(`Некоректне значення: ${label}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new LeadError(`Некоректне значення: ${label}.`);
  return parsed;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ error: 'Потрібно увійти.' }, 401);
    const params = new URL(request.url).searchParams;
    const leadId = params.get('id')?.trim();
    if (!leadId || leadId.length > 200)
      throw new LeadError('Ліда не знайдено.', 404);
    const rawLimit = params.get('limit');
    const limit = rawLimit === null ? DEFAULT_LIMIT : safeInteger(rawLimit, 'ліміт');
    if (limit < 1 || limit > MAX_LIMIT)
      throw new LeadError('Ліміт має бути від 1 до 50.');
    const version = safeInteger(params.get('version'), 'версія картки');
    const beforeSentAt = params.get('beforeSentAt');
    const beforeId = params.get('beforeId');
    if ((beforeSentAt === null) !== (beforeId === null))
      throw new LeadError('Курсор історії неповний.');
    const before: MessageCursor | undefined =
      beforeSentAt === null || beforeId === null
        ? undefined
        : { sentAt: safeInteger(beforeSentAt, 'час курсору'), id: beforeId };
    if (before && (before.id.length === 0 || before.id.length > 200))
      throw new LeadError('Некоректний курсор історії.');
    const page = await new D1LeadRepository(getDb()).loadMessages(
      user.id,
      leadId,
      { limit, before, version },
    );
    if (!page) throw new LeadError('Ліда не знайдено.', 404);
    return json({
      messages: page.messages.map(({ userId: _user, ...message }) => message),
      page: { hasMore: page.hasMore, before: page.before },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
