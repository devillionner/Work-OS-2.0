import { cleanChatName, normalizeGroupLink } from './bulk-input.ts';
import { isGeneratedChatName, resolveChatName, shouldAutoApplyResolvedName, type ChatNameResolution } from './name-resolution.ts';

export type ChatNameScanStatus = 'updated' | 'unchanged' | 'confirm' | 'error';
export type ChatNameScanItem = {
  id: string;
  platform: string;
  currentName: string;
  suggestedName: string | null;
  status: ChatNameScanStatus;
  updatedAt: number;
  error: string | null;
};
export type ChatNameScanResult = {
  items: ChatNameScanItem[];
  counts: Record<string, { checked: number; updated: number; unchanged: number; confirm: number; error: number }>;
  nextCursor: string | null;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type Row = { id: string; platform: string; name: string; link: string; updated_at: number };

const MAX_BATCH = 12;
const AUTO_ENRICH_MAX = 60;

export async function scanChatNames(
  db: D1Database,
  userId: string,
  input: { cursor?: string | null; ids?: string[]; limit?: number },
  now: number,
  fetcher: FetchLike = fetch,
): Promise<ChatNameScanResult> {
  const ids = normalizeIds(input.ids);
  const limit = Math.max(1, Math.min(MAX_BATCH, Number.isSafeInteger(input.limit) ? Number(input.limit) : MAX_BATCH));
  let rows: Row[];
  let hasMore = false;
  if (ids.length) {
    const result = await db.prepare(`SELECT id,platform,name,link,updated_at FROM chats
      WHERE user_id=?1 AND platform IN ('telegram','whatsapp','viber','facebook')
        AND id IN (SELECT value FROM json_each(?2))
      ORDER BY id LIMIT ?3`).bind(userId, JSON.stringify(ids), MAX_BATCH).all<Row>();
    rows = result.results;
  } else {
    const cursor = typeof input.cursor === 'string' ? input.cursor.slice(0, 200) : '';
    const result = await db.prepare(`SELECT id,platform,name,link,updated_at FROM chats
      WHERE user_id=?1 AND platform IN ('telegram','whatsapp','viber','facebook') AND id>?2
      ORDER BY id LIMIT ?3`).bind(userId, cursor, limit + 1).all<Row>();
    rows = result.results.slice(0, limit);
    hasMore = result.results.length > limit;
  }

  const resolved = await Promise.all(rows.map(async (row) => {
    const resolution = await resolveChatName(row.link, fetcher);
    return { row, resolution };
  }));

  const items: ChatNameScanItem[] = [];
  const updates: Array<{ row: Row; resolution: ChatNameResolution; nextUpdatedAt: number }> = [];
  for (const entry of resolved) {
    const { row, resolution } = entry;
    if (!resolution) {
      items.push(project(row, null, 'error', row.updated_at, 'Назву не вдалося прочитати з публічної сторінки.'));
      continue;
    }
    if (sameName(row.name, resolution.name)) {
      items.push(project(row, resolution.name, 'unchanged', row.updated_at, null));
      continue;
    }
    if (!shouldAutoApplyResolvedName(row.name, row.link, resolution.name)) {
      items.push(project(row, resolution.name, 'confirm', row.updated_at, null));
      continue;
    }
    updates.push({ row, resolution, nextUpdatedAt: Math.max(now, Number(row.updated_at) + 1) });
  }

  if (updates.length) {
    const results = await db.batch(updates.map(({ row, resolution, nextUpdatedAt }) =>
      db.prepare(`UPDATE chats SET name=?1,updated_at=?2
        WHERE id=?3 AND user_id=?4 AND updated_at=?5`)
        .bind(cleanChatName(resolution.name), nextUpdatedAt, row.id, userId, row.updated_at),
    ));
    updates.forEach((entry, index) => {
      const changed = Number(results[index].meta?.changes || 0) > 0;
      items.push(project(
        entry.row,
        entry.resolution.name,
        changed ? 'updated' : 'error',
        changed ? entry.nextUpdatedAt : entry.row.updated_at,
        changed ? null : 'Чат змінився під час перевірки. Повторіть перевірку.',
      ));
    });
  }

  items.sort((a, b) => a.id.localeCompare(b.id));
  return {
    items,
    counts: summarize(items),
    nextCursor: !ids.length && hasMore && rows.length ? rows[rows.length - 1].id : null,
  };
}

export async function enrichImportedChatNames(
  db: D1Database,
  userId: string,
  links: string[],
  now: number,
  fetcher: FetchLike = fetch,
): Promise<{ checked: number; updated: number; confirm: number; error: number; truncated: boolean }> {
  const supported = [...new Set(links.flatMap((link) => {
    const parsed = normalizeGroupLink(link);
    return parsed && ['telegram', 'whatsapp', 'viber', 'facebook'].includes(parsed.platform) ? [parsed.link] : [];
  }))];
  const selected = supported.slice(0, AUTO_ENRICH_MAX);
  if (!selected.length) return { checked: 0, updated: 0, confirm: 0, error: 0, truncated: false };

  const result = await db.prepare(`SELECT id,platform,name,link,updated_at FROM chats
    WHERE user_id=?1 AND normalized_link IN (SELECT value FROM json_each(?2))
      AND platform IN ('telegram','whatsapp','viber','facebook')
    ORDER BY id LIMIT ?3`)
    .bind(userId, JSON.stringify(selected), AUTO_ENRICH_MAX).all<Row>();

  let checked = 0;
  let updated = 0;
  let confirm = 0;
  let error = 0;
  for (let offset = 0; offset < result.results.length; offset += MAX_BATCH) {
    const ids = result.results.slice(offset, offset + MAX_BATCH).map((row) => row.id);
    const batch = await scanChatNames(db, userId, { ids }, now, fetcher);
    checked += batch.items.length;
    updated += batch.items.filter((item) => item.status === 'updated').length;
    confirm += batch.items.filter((item) => item.status === 'confirm').length;
    error += batch.items.filter((item) => item.status === 'error').length;
  }
  return { checked, updated, confirm, error, truncated: supported.length > selected.length };
}

export async function confirmResolvedChatName(
  db: D1Database,
  userId: string,
  input: { id: string; expectedUpdatedAt: number; name: string },
  now: number,
): Promise<{ id: string; name: string; updatedAt: number }> {
  const id = input.id.trim().slice(0, 200);
  const name = cleanChatName(input.name);
  if (!id || !name || !Number.isSafeInteger(input.expectedUpdatedAt) || input.expectedUpdatedAt < 0)
    throw new Error('Некоректне підтвердження назви.');
  const updatedAt = Math.max(now, input.expectedUpdatedAt + 1);
  const result = await db.prepare(`UPDATE chats SET name=?1,updated_at=?2
    WHERE id=?3 AND user_id=?4 AND updated_at=?5
      AND platform IN ('telegram','whatsapp','viber','facebook')`)
    .bind(name, updatedAt, id, userId, input.expectedUpdatedAt).run();
  if (Number(result.meta?.changes || 0) < 1) throw new Error('Чат уже змінився. Перевірте назви ще раз.');
  return { id, name, updatedAt };
}

export function isSafeAutomaticNameReplacement(currentName: string, link: string) {
  return !cleanChatName(currentName) || isGeneratedChatName(currentName, link);
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 200)).filter(Boolean);
  return [...new Set(ids)].slice(0, MAX_BATCH);
}

function project(row: Row, suggestedName: string | null, status: ChatNameScanStatus, updatedAt: number, error: string | null): ChatNameScanItem {
  return {
    id: row.id,
    platform: row.platform,
    currentName: row.name,
    suggestedName,
    status,
    updatedAt,
    error,
  };
}

function summarize(items: ChatNameScanItem[]) {
  const result: ChatNameScanResult['counts'] = {};
  for (const item of items) {
    const current = result[item.platform] ||= { checked: 0, updated: 0, unchanged: 0, confirm: 0, error: 0 };
    current.checked += 1;
    current[item.status] += 1;
  }
  return result;
}

function sameName(left: string, right: string) {
  return cleanChatName(left).toLocaleLowerCase('uk-UA') === cleanChatName(right).toLocaleLowerCase('uk-UA');
}
