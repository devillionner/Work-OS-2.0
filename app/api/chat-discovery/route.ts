import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { applyDiscoveryInspection } from '@/lib/chat-discovery/inspection';
import {
  DiscoveryError,
  advanceTelegramDiscoveryPlan,
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
  if (!sameOrigin(request)) return json({ error: 'Недійсне джерело запиту.' }, 403);
  const body = await readJsonObject(request, 256 * 1024);
  if (body instanceof Response) return body;
  const now = Math.floor(Date.now() / 1000);

  try {
    if (body.action === 'start') {
      const run = await startDiscoveryRun(env.DB, user.id, {
        platforms: body.platforms,
        goal: body.goal,
        minMembers: body.minMembers,
      }, now);
      return json({ run });
    }
    if (body.action === 'telegram-plan') {
      if (typeof body.runId !== 'string' || !body.runId) throw new DiscoveryError('Запуск пошуку не вказаний.');
      return json(await readTelegramDiscoveryPlan(env.DB, user.id, body.runId, Number(body.limit) || 6));
    }
    if (body.action === 'advance-telegram-plan') {
      if (typeof body.runId !== 'string' || !body.runId || !Number.isSafeInteger(body.version) || !Number.isSafeInteger(body.processed)) {
        throw new DiscoveryError('Некоректний стан Telegram-плану.');
      }
      return json(await advanceTelegramDiscoveryPlan(
        env.DB,
        user.id,
        body.runId,
        Number(body.version),
        Number(body.processed),
        now,
      ));
    }
    if (body.action === 'continue') {
      if (typeof body.runId !== 'string' || !body.runId) throw new DiscoveryError('Запуск пошуку не вказаний.');
      return json(await continueDiscoveryRun(env.DB, user.id, body.runId, now));
    }
    if (body.action === 'cancel') {
      if (typeof body.runId !== 'string' || !body.runId || !Number.isSafeInteger(body.version)) {
        throw new DiscoveryError('Некоректний стан запуску.');
      }
      return json(await cancelDiscoveryRun(env.DB, user.id, body.runId, Number(body.version), now));
    }
    if (body.action === 'ingest-telegram') {
      if (typeof body.runId !== 'string' || !body.runId) throw new DiscoveryError('Запуск пошуку не вказаний.');
      return json(await ingestTelegramDiscovery(env.DB, user.id, body.runId, {
        text: body.text,
        sourceUrl: body.sourceUrl,
        sourceTitle: body.sourceTitle,
        query: body.query,
        seedLabel: body.seedLabel,
        context: body.context,
      }, now));
    }
    if (body.action === 'import') {
      if (typeof body.candidateId !== 'string' || !body.candidateId || !Number.isSafeInteger(body.version)) {
        throw new DiscoveryError('Некоректний кандидат.');
      }
      return json(await handoffDiscoveryCandidate(env.DB, user.id, body.candidateId, Number(body.version), now));
    }
    if (body.action === 'inspect') {
      if (typeof body.candidateId !== 'string' || !body.candidateId || !Number.isSafeInteger(body.version)) {
        throw new DiscoveryError('Некоректний кандидат.');
      }
      return json(await applyDiscoveryInspection(env.DB, user.id, {
        candidateId: body.candidateId,
        expectedVersion: Number(body.version),
        result: body.result,
        minMembers: body.minMembers,
      }, now));
    }
    throw new DiscoveryError('Невідома дія.');
  } catch (error) {
    if (error instanceof DiscoveryError) return json({ error: error.message }, error.status);
    console.error('Chat discovery action failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Пошук чатів не завершено. Спробуйте ще раз.' }, 500);
  }
}
