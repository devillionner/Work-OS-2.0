import type { PoolAudience, PoolLanguage } from '@/lib/telegram-pool/parse';

/** Пул текстових оголошень Telegram, як його віддає сервер (`GET /api/messenger-automation?telegramPool=1`). */
export type PoolSummary = { total: number; free: number; expired: number; ending: string[]; byDirection: Array<{ direction: string; total: number; free: number }> };
export type PoolItemView = {
  id: string; text: string; snippet: string; language: PoolLanguage; direction: string; audience: PoolAudience; until: string | null; author: string;
  expired: boolean; free: boolean;
};
export type PoolView = { summary: PoolSummary; items: PoolItemView[] };

/** Що піде в чати партії: підібраний текст кожному чату й вільні тексти для ручної заміни (`telegram-pool-preview`). */
export type PoolPreview = {
  active: boolean;
  items: Record<string, { adId: string; snippet: string; label: string; note: string | null; forced: boolean; directions: string[] }>;
  scan: string[];
  waiting: string[];
  options: Array<{ id: string; snippet: string; label: string; direction: string }>;
};

export const AUDIENCE_NAMES: Record<PoolAudience, string> = { kids: 'діти', adults: 'дорослі', any: 'усі' };

/** Ending directions as a short phrase: «закінчуються: Логопедія та дефектологія, Математика». */
export const endingText = (summary: PoolSummary) => (summary.ending.length ? `закінчуються: ${summary.ending.join(', ')}` : '');

export async function fetchPool(): Promise<PoolView> {
  const response = await fetch('/api/messenger-automation?telegramPool=1', { cache: 'no-store' });
  const body = await response.json() as { pool?: PoolView; error?: string };
  if (!response.ok || !body.pool) throw new Error(body.error || 'Не вдалося прочитати пул оголошень.');
  return body.pool;
}
export async function savePoolList(mode: 'replace' | 'add', items: unknown[]): Promise<{ saved: number; skipped: number; archived: number; kept: number; pool: PoolView }> {
  const response = await fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'telegram-pool-save', mode, items }) });
  const body = await response.json() as { result?: { saved: number; skipped: number; archived: number; kept: number }; pool?: PoolView; error?: string };
  if (!response.ok || !body.result || !body.pool) throw new Error(body.error || 'Не вдалося зберегти пул оголошень.');
  return { ...body.result, pool: body.pool };
}
