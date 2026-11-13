import { canonicalDirection } from '../directions.ts';

/**
 * Суворі правила профілю чату для автопосту (3.17.0): «лише ці напрямки», «лише ці оголошення», «без фото».
 * Живуть у `chat_profiles` (міграція 0063). Діють одразу після збереження профілю, незалежно від «підтверджено»: це явне рішення власника.
 */
export type ChatRules = {
  /** Цільові напрямки профілю (канонічні). */
  directions: string[];
  /** «Публікувати лише ці напрямки»: діє лише коли напрямки задано. */
  strict: boolean;
  /** Закріплені оголошення (id Бібліотеки чи тексту пулу Telegram): мають пріоритет над напрямами. */
  pinned: string[];
  noPhoto: boolean;
  /** «Без фото» поставив автопост, коли побачив технічну заборону медіа. */
  noPhotoAuto: boolean;
};

export const NO_RULES: ChatRules = { directions: [], strict: false, pinned: [], noPhoto: false, noPhotoAuto: false };

type RulesRow = { directions_json?: string | null; directions_strict?: number | null; pinned_ads_json?: string | null; no_photo?: number | null; no_photo_auto?: number | null };

function strings(value: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  } catch { return []; }
}

export function parseRules(row: RulesRow | null | undefined): ChatRules {
  if (!row) return NO_RULES;
  const directions = [...new Set(strings(row.directions_json).map((item) => canonicalDirection(item)).filter(Boolean))];
  return {
    directions,
    strict: Number(row.directions_strict) === 1 && directions.length > 0,
    pinned: [...new Set(strings(row.pinned_ads_json))],
    noPhoto: Number(row.no_photo) === 1,
    noPhotoAuto: Number(row.no_photo_auto) === 1,
  };
}

/** Правила одного чату (за первинним ключем профілю). */
export async function readChatRules(db: D1Database, chatId: string): Promise<ChatRules> {
  const row = await db.prepare(`SELECT directions_json,directions_strict,pinned_ads_json,no_photo,no_photo_auto FROM chat_profiles WHERE chat_id=?1 LIMIT 1`).bind(chatId).first<RulesRow>();
  return parseRules(row);
}

/** Правила кількох чатів одним запитом: `json_each` іде першим, профілі шукаються за первинним ключем (без скану). */
export async function readChatRulesMany(db: D1Database, chatIds: readonly string[]): Promise<Map<string, ChatRules>> {
  const result = new Map<string, ChatRules>();
  if (!chatIds.length) return result;
  const rows = await db.prepare(`SELECT p.chat_id AS chat_id,p.directions_json AS directions_json,p.directions_strict AS directions_strict,p.pinned_ads_json AS pinned_ads_json,p.no_photo AS no_photo,p.no_photo_auto AS no_photo_auto
    FROM json_each(?1) e CROSS JOIN chat_profiles p ON p.chat_id=e.value`).bind(JSON.stringify(chatIds)).all<RulesRow & { chat_id: string }>();
  for (const row of rows.results || []) result.set(row.chat_id, parseRules(row));
  return result;
}

const same = (left: string, right: string) => canonicalDirection(left).toLocaleLowerCase('uk-UA') === canonicalDirection(right).toLocaleLowerCase('uk-UA');
/** Чи напрям `direction` входить у дозволені напрями чату. */
export const directionAllowed = (rules: Pick<ChatRules, 'directions'>, direction: string) => Boolean(direction) && rules.directions.some((item) => same(item, direction));

/** Тихі позначки правил для списків: «лише Малювання», «закріплені оголошення · 2», «без фото». */
export function ruleBadges(rules: ChatRules): string[] {
  const badges: string[] = [];
  if (rules.pinned.length) badges.push(`закріплені оголошення · ${rules.pinned.length}`);
  else if (rules.strict) badges.push(`лише ${rules.directions.join(', ')}`);
  if (rules.noPhoto) badges.push('без фото');
  return badges;
}
