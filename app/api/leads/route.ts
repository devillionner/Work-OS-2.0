import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/db';
import { D1LeadRepository } from '@/lib/leads/data/repository';
import { executeLeadCommand } from '@/lib/leads/application/service';
import {
  leadDetail,
  exportConversation,
} from '@/lib/leads/application/queries';
import { commandBody, errorResponse, json } from '@/lib/leads/application/http';
import { LeadError } from '@/lib/leads/domain/validation';
import { overdue } from '@/lib/leads/domain/time';

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ error: 'Потрібно увійти.' }, 401);
    const repo = new D1LeadRepository(getDb());
    const params = new URL(request.url).searchParams;
    const id = params.get('id');
    const now = Math.floor(Date.now() / 1000);
    if (id) {
      const aggregate = await repo.load(
        user.id,
        id,
        params.get('export') === 'txt' ? {} : { messageLimit: 30 },
      );
      if (!aggregate) throw new LeadError('Ліда не знайдено.', 404);
      if (params.get('export') === 'txt')
        return new Response(exportConversation(aggregate), {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition':
              'attachment; filename="lead-conversation.txt"',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      return json(leadDetail(aggregate, now));
    }
    const offset = Number(params.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000)
      throw new LeadError('Некоректна сторінка.');
    const result = await repo.list(
      user.id,
      {
        archived: params.get('archived') === 'true',
        overdue: params.get('overdue') === 'true',
        search: (params.get('search') ?? '').slice(0, 200),
        offset,
      },
      now,
    );
    return json({
      ...result,
      leads: result.leads.map((l) => ({ ...l, overdue: overdue(l, now) })),
      serverNow: now,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ error: 'Потрібно увійти.' }, 401);
    const repo = new D1LeadRepository(getDb());
    const id = await executeLeadCommand(
      repo,
      user.id,
      await commandBody(request),
    );
    return json({ id });
  } catch (error) {
    return errorResponse(error);
  }
}
