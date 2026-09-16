import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/db';
import { D1LeadRepository } from '@/lib/leads/data/repository';
import { executeLeadCommand } from '@/lib/leads/application/service';
import { leadDetail } from '@/lib/leads/application/queries';
import { prepareConversationExport } from '@/lib/leads/application/conversation-export';
import { commandBody, errorResponse, json } from '@/lib/leads/application/http';
import { LeadError } from '@/lib/leads/domain/validation';
import { overdue } from '@/lib/leads/domain/time';

const LEAD_LIST_VIEWS = new Set([
  'active',
  'responses',
  'curator',
  'needs-details',
  'overdue',
  'archived',
]);

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ error: 'Потрібно увійти.' }, 401);
    const repo = new D1LeadRepository(getDb());
    const params = new URL(request.url).searchParams;
    const id = params.get('id');
    const now = Math.floor(Date.now() / 1000);
    if (id && params.get('export') === 'txt') {
      const prepared = await prepareConversationExport(env.DB, user.id, id);
      if (!prepared) throw new LeadError('Ліда не знайдено.', 404);
      return new Response(prepared.stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition':
            'attachment; filename="lead-conversation.txt"',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (id) {
      const aggregate = await repo.load(user.id, id, { messageLimit: 30 });
      if (!aggregate) throw new LeadError('Ліда не знайдено.', 404);
      return json(leadDetail(aggregate, now));
    }
    const offset = Number(params.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000)
      throw new LeadError('Некоректна сторінка.');
    const requestedView = params.get('view');
    if (requestedView && !LEAD_LIST_VIEWS.has(requestedView))
      throw new LeadError('Некоректний фільтр лідів.');
    const view = requestedView || '';
    const result = await repo.list(
      user.id,
      {
        archived: view ? view === 'archived' : params.get('archived') === 'true',
        overdue: view ? view === 'overdue' : params.get('overdue') === 'true',
        responses: view === 'responses',
        curator: view === 'curator',
        needsDetails: view === 'needs-details',
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
