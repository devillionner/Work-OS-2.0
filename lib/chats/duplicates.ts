import { cleanChatName, normalizeGroupLink, type ChatPlatform } from './bulk-input.ts';

export const DUPLICATE_SCAN_LIMIT = 10_000;

export type DuplicateChat = {
  id: string;
  platform: ChatPlatform;
  name: string;
  link: string;
  status: string;
  archiveReason: string | null;
  telegramAccountId: string | null;
};

export type DuplicateGroup = {
  key: string;
  reason: 'link' | 'name';
  chats: DuplicateChat[];
};

type DuplicateRow = {
  id: string;
  platform: ChatPlatform;
  name: string;
  link: string;
  normalized_link: string | null;
  workflow_status: string;
  archive_reason: string | null;
  telegram_account_id: string | null;
};

export class DuplicateScanError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = 'DuplicateScanError';
    this.status = status;
  }
}

export async function findChatDuplicates(
  db: D1Database,
  input: { userId: string; platform?: ChatPlatform | null; telegramAccountId?: string | null },
): Promise<DuplicateGroup[]> {
  const platform = input.platform || null;
  const telegramAccountId = platform === 'telegram' ? input.telegramAccountId || null : null;
  const result = await db.prepare(`SELECT id,platform,name,link,normalized_link,workflow_status,
      archive_reason,telegram_account_id
    FROM chats
    WHERE user_id=?1 AND (?2 IS NULL OR platform=?2)
      AND (?2!='telegram' OR ?3 IS NULL OR telegram_account_id=?3
        OR (telegram_account_id IS NULL AND workflow_status='to_join'))
    ORDER BY platform,name,id LIMIT ?4`)
    .bind(input.userId, platform, telegramAccountId, DUPLICATE_SCAN_LIMIT + 1)
    .all<DuplicateRow>();
  if (result.results.length > DUPLICATE_SCAN_LIMIT) {
    throw new DuplicateScanError('Понад 10 000 чатів у вибраному наборі. Уточніть платформу перед перевіркою дублікатів.');
  }

  const rows = result.results.map((row) => ({
    row,
    canonicalLink: canonicalChatLink(row),
    normalizedName: normalizeChatName(row.name),
  }));
  const linkGroups = groupBy(rows.filter((item) => item.canonicalLink), (item) => `${item.row.platform}:${item.canonicalLink}`);
  const exactLinkGroups = [...linkGroups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]): DuplicateGroup => ({ key, reason: 'link', chats: items.map(toChat) }));

  const nameGroups = groupBy(rows.filter((item) => item.normalizedName), (item) => `${item.row.platform}:${item.normalizedName}`);
  const potentialNameGroups = [...nameGroups.entries()]
    .filter(([, items]) => items.length > 1 && new Set(items.map((item) => item.canonicalLink || `raw:${item.row.link}`)).size > 1)
    .map(([key, items]): DuplicateGroup => ({ key, reason: 'name', chats: items.map(toChat) }));

  return [...exactLinkGroups, ...potentialNameGroups]
    .sort((a, b) => a.chats[0].platform.localeCompare(b.chats[0].platform)
      || (a.reason === b.reason ? a.chats[0].name.localeCompare(b.chats[0].name, 'uk') : a.reason === 'link' ? -1 : 1));
}

function canonicalChatLink(row: DuplicateRow): string | null {
  for (const value of [row.normalized_link, row.link]) {
    if (!value) continue;
    const parsed = normalizeGroupLink(value);
    if (parsed && parsed.platform === row.platform) return parsed.link;
  }
  return null;
}

function normalizeChatName(value: string): string {
  return cleanChatName(value).toLocaleLowerCase('uk-UA');
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    const current = groups.get(value) || [];
    current.push(item);
    groups.set(value, current);
  }
  return groups;
}

function toChat(item: { row: DuplicateRow }): DuplicateChat {
  const row = item.row;
  return {
    id: row.id,
    platform: row.platform,
    name: row.name,
    link: row.link,
    status: row.workflow_status,
    archiveReason: row.archive_reason,
    telegramAccountId: row.telegram_account_id,
  };
}
