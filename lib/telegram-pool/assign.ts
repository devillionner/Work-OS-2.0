/**
 * Підбір оголошень з пулу для чатів партії Telegram: чиста функція без бази.
 * Розподіл жадібний за всією партією: спершу чат із найменшим вибором, тож найкращі тексти не забирають перші чати.
 */
import { canonicalDirection } from '../directions.ts';
import type { PoolAudience, PoolLanguage } from './parse.ts';

export type PoolText = {
  id: string; version: number; text: string; language: PoolLanguage; direction: string; audience: PoolAudience; until: string | null; author: string;
  /** Дата (бізнес-доба), коли такий самий текст уже виходив з попереднього пулу: після «Замінити» він сьогодні не видається знову. */
  usedOn?: string | null;
};
export type PoolChat = {
  id: string; name: string; language: PoolLanguage | null; directions: string[];
  /** Тексти пулу, які вже виходили в цьому чаті за останні 14 днів. */
  recent: ReadonlySet<string>;
};
export type PoolReason =
  /** Напрям тексту є в профілі чату. */
  | { kind: 'match' }
  /** Профіль без напрямів або текст без напряму: підходить будь-якому чату. */
  | { kind: 'general' }
  /** Текст іншого напряму; `wanted` — напрями чату, `empty` — у пулі таких текстів на сьогодні вже немає (або не було зовсім). */
  | { kind: 'other'; wanted: string[]; exhausted: boolean };
export type PoolAssignment = { chatId: string; text: PoolText; score: number; reason: PoolReason; repeat: boolean };

const sameDirection = (a: string, b: string) => Boolean(a) && Boolean(b) && canonicalDirection(a).toLocaleLowerCase('uk-UA') === canonicalDirection(b).toLocaleLowerCase('uk-UA');
const normalized = (values: readonly string[]) => values.map((value) => canonicalDirection(value).toLocaleLowerCase('uk-UA')).filter(Boolean);

/** Аудиторія чату за назвою: мами, діти, школа — діти/батьки; робота, барахолка, «Українці в …» — дорослі. */
export function chatAudience(name: string, directions: readonly string[] = []): PoolAudience {
  const text = `${name} ${directions.join(' ')}`.toLocaleLowerCase('uk-UA');
  if (/(?<![\p{L}])(?:мам|мами|діт|дит|малюк|малеч|школ|садо?к|садочк|батьк|материнств|дошкіл|ясл|родител|дети|мамы|kids|baby)/u.test(text)) return 'kids';
  if (/(?<![\p{L}])(?:робот|ваканс|барахолк|біржа|авто|житл|оренд|нерухом|послуг|фріланс|українці|украинцы|ukrainians|купівл|продаж|кордон)/u.test(text)) return 'adults';
  return 'any';
}

export function scoreChatText(chat: PoolChat, text: PoolText, used: ReadonlyMap<string, number>, audience: PoolAudience): number {
  const wanted = normalized(chat.directions);
  let score = 0;
  if (wanted.length === 0) score += 10;
  else if (!text.direction) score += 10;
  else if (wanted.includes(canonicalDirection(text.direction).toLocaleLowerCase('uk-UA'))) score += 100;
  if (chat.language) score += text.language === chat.language ? 30 : -40;
  if (text.audience !== 'any' && audience !== 'any') score += text.audience === audience ? 15 : -25;
  else if (text.audience === 'any' || audience === 'any') score += 3;
  if (chat.recent.has(text.id)) score -= 60;
  score -= 4 * (used.get(text.direction) ?? 0);
  return score;
}

/**
 * `forced` — тексти, які власник вибрав для окремих чатів («Змінити»): вони призначаються першими.
 * Повертає призначення в порядку чатів; чат без вільного тексту в результат не входить.
 */
export function assignPoolTexts(chats: readonly PoolChat[], texts: readonly PoolText[], options: { taken?: ReadonlySet<string>; today: string; forced?: ReadonlyMap<string, string> }): { assigned: Map<string, PoolAssignment>; waiting: string[]; free: number } {
  const taken = options.taken ?? new Set<string>();
  const usable = texts.filter((text) => !taken.has(text.id) && (!text.until || text.until >= options.today));
  const free = new Map(usable.map((text) => [text.id, text]));
  const total = new Map<string, number>();
  for (const text of texts) if (!text.until || text.until >= options.today) total.set(canonicalDirection(text.direction).toLocaleLowerCase('uk-UA'), (total.get(canonicalDirection(text.direction).toLocaleLowerCase('uk-UA')) ?? 0) + 1);
  const assigned = new Map<string, PoolAssignment>();
  const used = new Map<string, number>();
  const wantedOf = new Map(chats.map((chat) => [chat.id, normalized(chat.directions)]));
  const audienceOf = new Map(chats.map((chat) => [chat.id, chatAudience(chat.name, chat.directions)]));

  const take = (chat: PoolChat, text: PoolText, score: number) => {
    free.delete(text.id);
    used.set(text.direction, (used.get(text.direction) ?? 0) + 1);
    const wanted = wantedOf.get(chat.id) ?? [];
    const key = canonicalDirection(text.direction).toLocaleLowerCase('uk-UA');
    const reason: PoolReason = wanted.length === 0 || !text.direction ? { kind: 'general' }
      : wanted.includes(key) ? { kind: 'match' }
        : { kind: 'other', wanted: chat.directions.map((value) => canonicalDirection(value)).filter(Boolean), exhausted: wanted.some((direction) => (total.get(direction) ?? 0) > 0) };
    assigned.set(chat.id, { chatId: chat.id, text, score, reason, repeat: chat.recent.has(text.id) });
  };
  const best = (chat: PoolChat): { text: PoolText; score: number } | null => {
    let pick: { text: PoolText; score: number } | null = null;
    for (const text of free.values()) {
      const score = scoreChatText(chat, text, used, audienceOf.get(chat.id) ?? 'any');
      if (!pick || score > pick.score) pick = { text, score };
    }
    return pick;
  };

  const pending: PoolChat[] = [];
  for (const chat of chats) {
    const forcedId = options.forced?.get(chat.id);
    const forcedText = forcedId ? free.get(forcedId) : undefined;
    if (forcedText) take(chat, forcedText, scoreChatText(chat, forcedText, used, audienceOf.get(chat.id) ?? 'any'));
    else pending.push(chat);
  }
  // Спершу чат із найменшим вибором (скільки вільних текстів його напряму ще лишилось); чати без напряму й без жодного збігу — наприкінці.
  const matches = (chat: PoolChat) => {
    const wanted = wantedOf.get(chat.id) ?? [];
    if (!wanted.length) return Number.POSITIVE_INFINITY;
    let count = 0;
    for (const text of free.values()) if (wanted.includes(canonicalDirection(text.direction).toLocaleLowerCase('uk-UA'))) count += 1;
    return count === 0 ? Number.POSITIVE_INFINITY : count;
  };
  const waiting: string[] = [];
  const left = [...pending];
  while (left.length) {
    if (!free.size) { waiting.push(...left.map((chat) => chat.id)); break; }
    let at = 0; let fewest = matches(left[0]);
    for (let index = 1; index < left.length && fewest > 1; index += 1) {
      const count = matches(left[index]);
      if (count < fewest) { fewest = count; at = index; }
    }
    const [chat] = left.splice(at, 1);
    const pick = best(chat);
    if (pick) take(chat, pick.text, pick.score); else waiting.push(chat.id);
  }
  return { assigned, waiting, free: free.size };
}

/** Короткий опис напряму в родовому відмінку для пояснень («тексти англійської закінчились»). */
const GENITIVE: Record<string, string> = {
  'Англійська': 'англійської', 'Німецька': 'німецької', 'Польська': 'польської', 'Французька': 'французької', 'Італійська': 'італійської', 'Іспанська': 'іспанської', 'Чеська': 'чеської',
  'Математика': 'математики', 'Шкільні предмети — комплексно': 'шкільних предметів', 'Логопедія та дефектологія': 'логопедії', 'Малювання': 'малювання', 'ІТ та шахи': 'ІТ та шахів',
  'Дошкільна підготовка': 'дошкільної підготовки', 'Soft Skills': 'soft skills',
};
export const directionGenitive = (direction: string) => GENITIVE[canonicalDirection(direction)] ?? GENITIVE[direction] ?? direction.toLocaleLowerCase('uk-UA');
export const AUDIENCE_LABEL: Record<PoolAudience, string> = { kids: 'діти', adults: 'дорослі', any: 'усі' };
export const languageLabel = (language: PoolLanguage) => (language === 'ru' ? 'RU' : 'UA');

/** Рядок для «Переглянути чати партії»: «Математика · діти · UA» і, якщо напрям не той, чому. */
export function poolReasonText(assignment: Pick<PoolAssignment, 'text' | 'reason' | 'repeat'>): { label: string; note: string | null } {
  const { text, reason } = assignment;
  const label = [text.direction || 'Без напряму', AUDIENCE_LABEL[text.audience], languageLabel(text.language)].join(' · ');
  let note: string | null = null;
  if (reason.kind === 'other') {
    const wanted = reason.wanted.map(directionGenitive).join(', ');
    note = reason.exhausted ? `інший напрям: на сьогодні тексти ${wanted} закінчились` : `інший напрям: у списку немає текстів ${wanted}`;
  } else if (assignment.repeat) note = 'цей текст уже був у чаті за останні 14 днів';
  return { label, note };
}
