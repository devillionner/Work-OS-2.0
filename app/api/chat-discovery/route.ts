import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { applyDiscoveryInspection } from '@/lib/chat-discovery/inspection';
import {
  DiscoveryError,
  cancelDiscoveryRun,
  continueDiscoveryRun,
  handoffDiscoveryCandidate,
  ingestTelegramDiscovery,
  readDiscoveryWorkspace,
  readTelegramDiscoveryPlan,
  startDiscoveryRun,
} from '@/lib/chat-discovery/domain';

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return json({ error: 'Потрібна авторизація.' }, 401);
  const url = new URL(request.url);
  try {
    const workspace = await readDiscoveryWorkspace(env.DB, user.id, {
      decision: url.searchParams.get('decision'),
      limit: Number(url.searchParams.get('limit') || 60),
    });
    return json(workspace);
  } catch (error) {
    console.error('Chat discovery read failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Не вдалося завантажити пошук чатів.' }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return json({ error: 'Потрібна авторизація.' }, 401);
  if (!sameOrigin(request)) return json({ error: 'Некоректне джерело запиту.' }, 403);
  try {
    const body = await readJsonObject(request);
    const now = Date.now();
    if (body.action === 'start') {
      return json(await startDiscoveryRun(env.DB, user.id, { platforms: body.platforms, goal: body.goal, minMembers: body.minMembers }, now));
    }
    if (body.action === 'cancel') {
      return json(await cancelDiscoveryRun(env.DB, user.id, String(body.runId || ''), Number(body.expectedVersion), now));
    }
    if (body.action === 'continue') {
      return json(await continueDiscoveryRun(env.DB, user.id, String(body.runId || ''), now));
    }
    if (body.action === 'telegram-plan') {
      return json(await readTelegramDiscoveryPlan(env.DB, user.id, String(body.runId || ''), Number(body.limit || 6)));
    }
    if (body.action === 'ingest-telegram') {
      return json(await ingestTelegramDiscovery(env.DB, user.id, String(body.runId || ''), {
        text: body.text,
        sourceUrl: body.sourceUrl,
        sourceTitle: body.sourceTitle,
        query: body.query,
        seedLabel: body.seedLabel,
        context: body.context,
      }, now));
    }
    if (body.action === 'handoff') {
      return json(await handoffDiscoveryCandidate(env.DB, user.id, {
        candidateId: body.candidateId,
        expectedVersion: body.expectedVersion,
      }, now));
    }
    if (body.action === 'inspect') {
      return json(await applyDiscoveryInspection(env.DB, user.id, {
        candidateId: body.candidateId,
        expectedVersion: body.expectedVersion,
        minMembers: body.minMembers,
        result: body.result,
      }, now));
    }
    return json({ error: 'Невідома дія.' }, 400);
  } catch (error) {
    if (error instanceof DiscoveryError) return json({ error: error.message }, error.status);
    console.error('Chat discovery mutation failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Не вдалося виконати дію пошуку чатів.' }, 500);
  }
}
