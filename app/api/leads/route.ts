import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/db';
import { D1LeadRepository } from '@/lib/leads/data/repository';
import { listLeads, type LeadListView } from '@/lib/leads/data/list';
import { executeLeadCommand } from '@/lib/leads/application/service';
import { leadDetail } from '@/lib/leads/application/queries';
import { prepareConversationExport } from '@/lib/leads/application/conversation-export';
import { commandBody, errorResponse, json } from '@/lib/leads/application/http';
import { LeadError } from '@/lib/leads/domain/validation';
import { overdue } from '@/lib/leads/domain/time';
import { revisionCacheRequest, matchRevisionJson, putRevisionJson } from '@/lib/revision-cache';

const LEAD_LIST_VIEWS: readonly LeadListView[] = [
  'active',
  'responses',
  'curator',
  'needs-details',
  'overdue',
  'archived',
];

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
          'Content-Disposition': 'attachment; filename="lead-conversation.txt"',
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
    if (requestedView && !isLeadListView(requestedView))
      throw new LeadError('Некоректний фільтр лідів.');
    const view: LeadListView = requestedView && isLeadListView(requestedView)
      ? requestedView
      : params.get('archived') === 'true'
        ? 'archived'
        : params.get('overdue') === 'true'
          ? 'overdue'
          : 'active';
    const search=(params.get('search') ?? '').slice(0, 200);
    const cacheRequest=await revisionCacheRequest(env.DB,user.id,'leads-list',`${view}:${search}:${offset}:${Math.floor(now/30)}`);
    const cached=await matchRevisionJson(cacheRequest);
    if(cached)return cached;
    const result = await listLeads(
      env.DB,
      user.id,
      {
        view,
        search,
        offset,
      },
      now,
    );
    const payload={
      ...result,
      leads: result.leads.map((lead) => ({ ...lead, overdue: overdue(lead, now) })),
      serverNow: now,
    };
    await putRevisionJson(cacheRequest,payload,45);
    return Response.json(payload,{headers:{'Cache-Control':'no-store','X-Work-OS-Cache':'MISS'}});
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ error: 'Потрібно увійти.' }, 401);
    const repo = new D1LeadRepository(getDb());
    const id = await executeLeadCommand(repo, user.id, await commandBody(request));
    return json({ id });
  } catch (error) {
    return errorResponse(error);
  }
}

function isLeadListView(value: string): value is LeadListView {
  return LEAD_LIST_VIEWS.includes(value as LeadListView);
}
