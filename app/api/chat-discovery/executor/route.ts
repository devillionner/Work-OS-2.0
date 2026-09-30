import { env } from 'cloudflare:workers';
import { readJsonObject } from '@/lib/http-json';
import { DiscoveryError } from '@/lib/chat-discovery/domain';
import { applyDiscoveryInspection } from '@/lib/chat-discovery/inspection';
import { assertDiscoveryExecutorLease, claimDiscoveryExecutorQueue, completeDiscoveryExternalLeave, pauseWaitingWhatsAppCheckBatch } from '@/lib/chat-discovery/executor';
import { authenticateDiscoveryExecutor } from '@/lib/chat-discovery/executor-auth';

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const executor = await authenticateDiscoveryExecutor(env.DB, request, now);
    const url = new URL(request.url);
    return json(await claimDiscoveryExecutorQueue(env.DB, executor.userId, executor.deviceId, url.searchParams.get('limit'), now));
  } catch (error) {
    if (error instanceof DiscoveryError) return json({ error: error.message }, error.status);
    console.error('Discovery executor read failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Executor queue недоступна.' }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const executor = await authenticateDiscoveryExecutor(env.DB, request, now);
    const body = await readJsonObject(request, 64 * 1024);
    if (body instanceof Response) return body;
    if (body.action === 'advance-discovery') {
      throw new DiscoveryError('Source discovery тепер локальний і не пише проміжні результати в D1.', 409);
    }
    if (body.action === 'pause-waiting-check') {
      if (!Number.isSafeInteger(body.batchId) || Number(body.batchId) <= 0) {
        throw new DiscoveryError('Некоректний пакет перевірки.');
      }
      return json(await pauseWaitingWhatsAppCheckBatch(env.DB,executor.userId,Number(body.batchId),now));
    }
    if (body.action === 'inspect') {
      if (typeof body.candidateId !== 'string' || !Number.isSafeInteger(body.version)) {
        throw new DiscoveryError('Некоректний результат executor.');
      }
      await assertDiscoveryExecutorLease(env.DB, executor.userId, executor.deviceId, body.candidateId, Number(body.version), now);
      return json(await applyDiscoveryInspection(env.DB, executor.userId, {
        candidateId: body.candidateId,
        expectedVersion: Number(body.version),
        result: body.result,
        minMembers: body.minMembers,
        requireTargetVerification: true,
        executorDeviceId: executor.deviceId,
      }, now));
    }
    if (body.action === 'executor-leave') {
      if (typeof body.candidateId !== 'string' || !Number.isSafeInteger(body.version)
        || typeof body.chatStateToken !== 'string' || !body.chatStateToken) {
        throw new DiscoveryError('Некоректний результат executor.');
      }
      await assertDiscoveryExecutorLease(env.DB, executor.userId, executor.deviceId, body.candidateId, Number(body.version), now);
      return json(await completeDiscoveryExternalLeave(env.DB, executor.userId, {
        candidateId: body.candidateId,
        expectedVersion: Number(body.version),
        chatStateToken: body.chatStateToken,
        targetVerified: body.targetVerified,
      }, now));
    }
    throw new DiscoveryError('Невідома executor-дія.');
  } catch (error) {
    if (error instanceof DiscoveryError) return json({ error: error.message }, error.status);
    console.error('Discovery executor action failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Executor result не застосовано.' }, 500);
  }
}
