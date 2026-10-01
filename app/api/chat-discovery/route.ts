import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { readChatState } from '@/lib/chats/state';
import { transitionChat } from '@/lib/chats/transitions';
import { applyDiscoveryInspection } from '@/lib/chat-discovery/inspection';
import { completeDiscoveryExternalLeave, readDiscoveryExecutorQueue, wakeDiscoveryExecutorQueue } from '@/lib/chat-discovery/executor';
import { createDiscoveryExecutorDevice, listDiscoveryExecutorDevices, revokeDiscoveryExecutorDevice } from '@/lib/chat-discovery/executor-auth';
import {
  DiscoveryError,
  archiveDiscoveryCandidateForOperator,
  cancelDiscoveryRun,
  handoffDiscoveryCandidate,
  readDiscoveryWorkspace,
  readTelegramDiscoveryPlan,
  resetDiscoveryWorkspace,
  startDiscoveryRun,
} from '@/lib/chat-discovery/domain';

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function archiveStaleDiscoveryImports(db:D1Database,userId:string,now:number){
  const rows=await db.prepare(`SELECT DISTINCT c.id
    FROM chats c
    WHERE c.user_id=?1 AND c.platform='whatsapp'
      AND c.workflow_status IN ('to_join','waiting','ready')
      AND c.joined_at IS NULL
      AND EXISTS(
        SELECT 1 FROM activity_events e
        WHERE e.user_id=c.user_id AND e.chat_id=c.id AND e.event_type='chat_discovery_imported'
      )
      AND NOT EXISTS(
        SELECT 1 FROM chat_discovery_candidates dc
        WHERE dc.user_id=c.user_id AND dc.imported_chat_id=c.id
      )
      AND NOT EXISTS(SELECT 1 FROM chat_publications p WHERE p.user_id=c.user_id AND p.chat_id=c.id)
      AND NOT EXISTS(SELECT 1 FROM leads l WHERE l.user_id=c.user_id AND l.source_chat_id=c.id)
    ORDER BY c.updated_at,c.id LIMIT 200`).bind(userId).all<{id:string}>();
  let archived=0;
  for(const row of rows.results){
    const chat=await readChatState(db,userId,row.id);
    if(!chat||chat.joined_at!==null||!['to_join','waiting','ready'].includes(chat.workflow_status))continue;
    const result=await transitionChat(db,{
      userId,chat,action:'archive',accountId:null,now,
      reason:'Очищено: старий автопошук',
    });
    if(result.ok)archived++;
  }
  const joined=await db.prepare(`SELECT DISTINCT c.id,c.name,c.link,c.workflow_status
    FROM chats c
    WHERE c.user_id=?1 AND c.platform='whatsapp'
      AND c.workflow_status IN ('to_join','waiting','ready')
      AND c.joined_at IS NOT NULL
      AND EXISTS(
        SELECT 1 FROM activity_events e
        WHERE e.user_id=c.user_id AND e.chat_id=c.id AND e.event_type='chat_discovery_imported'
      )
      AND NOT EXISTS(
        SELECT 1 FROM chat_discovery_candidates dc
        WHERE dc.user_id=c.user_id AND dc.imported_chat_id=c.id
      )
    ORDER BY c.updated_at,c.id LIMIT 20`).bind(userId).all<{id:string;name:string;link:string;workflow_status:string}>();
  return {
    archived,
    requiresExternalLeave:joined.results.length,
    joinedStale:joined.results.map(row=>({id:row.id,name:row.name,link:row.link,status:row.workflow_status})),
  };
}

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return json({ error: 'Потрібна авторизація.' }, 401);
  const url = new URL(request.url);
  try {
    if (url.searchParams.get('executor') === '1') {
      return json(await readDiscoveryExecutorQueue(env.DB, user.id, url.searchParams.get('limit')));
    }
    if (url.searchParams.get('executorDevices') === '1') {
      return json({ devices: await listDiscoveryExecutorDevices(env.DB, user.id) });
    }
    const workspace = await readDiscoveryWorkspace(env.DB, user.id, {
      decision: url.searchParams.get('decision'),
      waitingWhatsApp: url.searchParams.get('waitingWhatsApp') === '1',
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
    // Operator Discovery actions can create executor work; let the runner see it on its next poll.
    if (body.action !== 'pair-executor' && body.action !== 'revoke-executor') await wakeDiscoveryExecutorQueue(env.DB, user.id);
    if (body.action === 'pair-executor') {
      return json(await createDiscoveryExecutorDevice(env.DB, user.id, body.name, now));
    }
    if (body.action === 'revoke-executor') {
      if (typeof body.deviceId !== 'string' || !body.deviceId) throw new DiscoveryError('Підключення executor не вказано.');
      return json(await revokeDiscoveryExecutorDevice(env.DB, user.id, body.deviceId, now));
    }
    if (body.action === 'reset') {
      return json(await resetDiscoveryWorkspace(env.DB, user.id));
    }
    if (body.action === 'archive-stale-imports') {
      return json(await archiveStaleDiscoveryImports(env.DB, user.id, now));
    }
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
    if (body.action === 'continue') {
      throw new DiscoveryError('Source search тепер працює локально в браузері. Сирі кандидати не записуються в D1.', 409);
    }
    if (body.action === 'cancel') {
      if (typeof body.runId !== 'string' || !body.runId || !Number.isSafeInteger(body.version)) {
        throw new DiscoveryError('Некоректний стан запуску.');
      }
      return json(await cancelDiscoveryRun(env.DB, user.id, body.runId, Number(body.version), now));
    }
    if (body.action === 'ingest-telegram') {
      throw new DiscoveryError('Telegram source preview тепер локальний. Використовуйте preview API; запис у D1 відбувається лише після підтвердження.', 409);
    }
    if (body.action === 'archive-candidate') {
      if (typeof body.candidateId !== 'string' || !body.candidateId || !Number.isSafeInteger(body.version)) {
        throw new DiscoveryError('Некоректний кандидат.');
      }
      return json(await archiveDiscoveryCandidateForOperator(env.DB,user.id,body.candidateId,Number(body.version),now));
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
    if (body.action === 'executor-leave') {
      if (typeof body.candidateId !== 'string' || !body.candidateId || !Number.isSafeInteger(body.version)
        || typeof body.chatStateToken !== 'string' || !body.chatStateToken) {
        throw new DiscoveryError('Некоректний результат executor.');
      }
      return json(await completeDiscoveryExternalLeave(env.DB, user.id, {
        candidateId: body.candidateId,
        expectedVersion: Number(body.version),
        chatStateToken: body.chatStateToken,
        targetVerified: body.targetVerified,
      }, now));
    }
    throw new DiscoveryError('Невідома дія.');
  } catch (error) {
    if (error instanceof DiscoveryError) return json({ error: error.message }, error.status);
    console.error('Chat discovery action failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Пошук чатів не завершено. Спробуйте ще раз.' }, 500);
  }
}
