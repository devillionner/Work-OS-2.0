/**
 * Розбір списку текстових оголошень для пулу автопосту Telegram: звичайні правила, без ШІ, без звернень до бази.
 * Працює в браузері (перегляд до збереження) і на сервері (та сама перевірка при збереженні).
 */
import { canonicalDirection } from '../directions.ts';

export const POOL_TEXT_LIMIT = 4096;
export type PoolAudience = 'kids' | 'adults' | 'any';
export type PoolLanguage = 'uk' | 'ru';

export type ParsedPoolAd = {
  /** Порядковий номер у вставленому списку (для ключів у переліку). */
  index: number;
  author: string;
  /** Рядки оголошення без порожніх країв; `drop` — індекси рядків, які прибрано автоматично (заклики для Instagram). */
  lines: string[];
  drop: number[];
  /** Текст після прибирання закликів (повернені рядки додає `poolAdText`). */
  text: string;
  direction: string;
  audience: PoolAudience;
  language: PoolLanguage;
  /** Остання дата (YYYY-MM-DD), до якої оголошення актуальне; null — без терміну. */
  until: string | null;
  length: number;
};

export type PoolRejected = {
  kind: 'heading' | 'duplicate' | 'near_duplicate' | 'too_long' | 'empty' | 'existing';
  author: string;
  text: string;
  /** Номер оголошення, на яке це схоже (для дублів). */
  of?: number;
  length?: number;
};

export type PoolParseResult = {
  ads: ParsedPoolAd[];
  rejected: PoolRejected[];
  /** Автори, яких розпізнано за рядками «Ім'я:». */
  authors: string[];
  /** Скільки зламаних символів «�» прибрано. */
  broken: number;
};

/** Напрями пулу: стандартні предмети Work OS, «ІТ та шахи» (так їх зберігають профілі чатів) і додаткові напрями скриптів. */
export const POOL_DIRECTIONS = [
  'Англійська', 'Німецька', 'Польська', 'Французька', 'Італійська', 'Іспанська', 'Чеська',
  'Математика', 'Шкільні предмети — комплексно', 'Логопедія та дефектологія', 'Малювання', 'ІТ та шахи',
  'Дошкільна підготовка', 'Soft Skills',
] as const;

const NEW_YEAR = /(?<![\p{L}])(?:до\s+нов(?:ого|ому|ий)\s+рок|до\s+новорічн|до\s+нового\s+года|до\s+кінця\s+року|до\s+конца\s+года)/iu;
const MONTHS: ReadonlyArray<[number, RegExp]> = [
  [1, /(?<![\p{L}])(?:січн|январ)/iu], [2, /(?<![\p{L}])(?:лютн|лютого|лютому|феврал)/iu], [3, /(?<![\p{L}])(?:берез|март(?![\p{L}])|марта)/iu],
  [4, /(?<![\p{L}])(?:квітн|апрел)/iu], [5, /(?<![\p{L}])(?:травн|мая(?![\p{L}])|мае(?![\p{L}]))/iu], [6, /(?<![\p{L}])(?:червн|июн)/iu],
  [7, /(?<![\p{L}])(?:липн|июл)/iu], [8, /(?<![\p{L}])(?:серпн|август)/iu], [9, /(?<![\p{L}])(?:вересн|сентябр)/iu],
  [10, /(?<![\p{L}])(?:жовтн|октябр)/iu], [11, /(?<![\p{L}])(?:листопад|ноябр)/iu], [12, /(?<![\p{L}])(?:грудн|декабр)/iu],
];
const MONTH_GENITIVE: ReadonlyArray<[number, string]> = [
  [1, 'січня'], [2, 'лютого'], [3, 'березня'], [4, 'квітня'], [5, 'травня'], [6, 'червня'],
  [7, 'липня'], [8, 'серпня'], [9, 'вересня'], [10, 'жовтня'], [11, 'листопада'], [12, 'грудня'],
];

/** Заклики для Instagram, недоречні в Telegram: такі рядки прибираються автоматично (їх можна повернути в перегляді). */
const INSTAGRAM_LINE: readonly RegExp[] = [
  /(?<![\p{L}])(?:дірект|директ|direct)(?![\p{L}])/iu,
  /шапк\p{L}*\s+профіл/iu,
  /(?:посилання|ссылк\p{L}*)\s+(?:в|у)\s+(?:біо|bio|профіл)/iu,
  /link\s+in\s+bio/iu,
  /(?:залиш|лиш|ставт|ставь|оставляйте)\p{L}*\s+[«"“]?\+[»"”]?/iu,
  /коментар\p{L}*[^\n]*\+|\+[^\n]*коментар/iu,
  /пиш\p{L}*\s+[«"“][\p{Lu}\d ]{3,15}[»"”]/u,
  /(?<![\p{L}])(?:інстаграм|instagram|інста|insta)(?![\p{L}])/iu,
];
export const isInstagramLine = (line: string) => INSTAGRAM_LINE.some((pattern) => pattern.test(line));

const KEYWORDS: ReadonlyArray<[string, RegExp[]]> = [
  ['Англійська', [/(?<![\p{L}])англійськ/iu, /(?<![\p{L}])английск/iu, /(?<![\p{L}])english/iu, /(?<![\p{L}])(?:ielts|toefl)/iu, /(?<![\p{L}])англ\./iu]],
  ['Німецька', [/(?<![\p{L}])німецьк/iu, /(?<![\p{L}])немецк/iu, /(?<![\p{L}])deutsch/iu]],
  ['Польська', [/(?<![\p{L}])польськ/iu, /(?<![\p{L}])польск/iu]],
  ['Французька', [/(?<![\p{L}])французьк/iu, /(?<![\p{L}])французск/iu]],
  ['Італійська', [/(?<![\p{L}])італійськ/iu, /(?<![\p{L}])итальянск/iu]],
  ['Іспанська', [/(?<![\p{L}])іспанськ/iu, /(?<![\p{L}])испанск/iu]],
  ['Чеська', [/(?<![\p{L}])чеськ/iu, /(?<![\p{L}])чешск/iu]],
  ['Математика', [/(?<![\p{L}])математи/iu, /(?<![\p{L}])матем[\s.]/iu, /(?<![\p{L}])алгебр/iu, /(?<![\p{L}])геометр/iu, /(?<![\p{L}])нмт(?![\p{L}])/iu, /(?<![\p{L}])єві(?![\p{L}])/iu, /(?<![\p{L}])(?:дпа|зно)(?![\p{L}])/iu]],
  ['Логопедія та дефектологія', [/(?<![\p{L}])логопед/iu, /(?<![\p{L}])дефектолог/iu, /(?<![\p{L}])мовленн/iu, /(?<![\p{L}])речев/iu, /(?<![\p{L}])вимов/iu, /(?<![\p{L}])дикці/iu, /звук(?:и|ів|ом)?\s+[рлшжчщс](?:[\s,/.]|$)/iu]],
  ['Малювання', [/(?<![\p{L}])малюван/iu, /(?<![\p{L}])рисован/iu, /(?<![\p{L}])скетч/iu]],
  ['ІТ та шахи', [/(?<![\p{L}])програмуван/iu, /(?<![\p{L}])программирован/iu, /(?<![\p{L}])(?:python|scratch|roblox|minecraft)/iu, /(?<![\p{L}])кодинг/iu, /(?<![\p{L}])шахи(?![\p{L}])/iu, /(?<![\p{L}])шахмат/iu, /(?<![\p{L}])(?:іт|it)(?![\p{L}])/iu, /(?<![\p{L}])робототехнік/iu]],
  ['Дошкільна підготовка', [/(?<![\p{L}])дошкільн/iu, /(?<![\p{L}])підготовк\p{L}*\s+до\s+школи/iu, /(?<![\p{L}])дошкольн/iu]],
  ['Soft Skills', [/soft\s*skills?/iu, /софт\s*скіл/iu, /(?<![\p{L}])м[’'ʼ]?які\s+навички/iu]],
  ['Шкільні предмети — комплексно', [/(?<![\p{L}])шкільн\p{L}*\s+предмет/iu, /(?<![\p{L}])школьн\p{L}*\s+предмет/iu]],
];

/** Службова назва напряму без тексту оголошення: «Математика», «Логопед», «Англійська:». */
function isDirectionHeading(line: string): boolean {
  const clean = line.replace(/(?:[\p{Extended_Pictographic}:.\-–—#*_]|\u200d|\uFE0F)+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || clean.split(' ').length > 3 || clean.length > 40) return false;
  if (canonicalDirection(clean) && POOL_DIRECTIONS.includes(canonicalDirection(clean) as (typeof POOL_DIRECTIONS)[number])) return true;
  return KEYWORDS.some(([, patterns]) => patterns.some((pattern) => pattern.test(`${clean} `))) && clean.split(' ').length <= 2;
}

/** Напрям за словами: перший рядок важить утричі; без жодного збігу напряму немає (оголошення підійде будь-якому чату, але з меншим балом). */
export function detectDirection(text: string): string {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const title = lines.slice(0, 2).join('\n');
  let best = ''; let bestScore = 0;
  for (const [direction, patterns] of KEYWORDS) {
    let score = 0;
    for (const pattern of patterns) {
      const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
      score += (text.match(global)?.length ?? 0) + (title.match(global)?.length ?? 0) * 2;
    }
    if (score > bestScore) { best = direction; bestScore = score; }
  }
  return bestScore >= 1 ? best : '';
}

const KIDS = /(?<![\p{L}])(?:діт|дит|малюк|малеч|малят|школяр|підлітк|першокласник|дошкільн|доньк|дочк|ребен|ребён|детей|детск)/iu;
const ADULTS = /(?<![\p{L}])(?:дорослих|дорослі|дорослим|взрослых|взрослые|для\s+себе|собі)/iu;
const PARENTS = /(?<![\p{L}])(?:батьки|батьків|мам[иіо]|мамо|тат[аи]|родител)/iu;
/** Вік «від 4 років», «6+», «4–7 років»: менше 14 — оголошення для дітей (його читають батьки). */
function detectAge(text: string): number | null {
  const match = text.match(/(?:від|с|от)\s+(\d{1,2})\s*(?:років|рокі|року|лет|года)/iu) ?? text.match(/(?<![\p{N}])(\d{1,2})\s*\+(?![\p{L}\p{N}])/u) ?? text.match(/(\d{1,2})\s*[–-]\s*\d{1,2}\s*(?:років|рокі|лет)/iu);
  return match ? Number(match[1]) : null;
}
export function detectAudience(text: string): PoolAudience {
  const age = detectAge(text);
  const kids = KIDS.test(text) || PARENTS.test(text) || (age !== null && age < 14);
  const adults = ADULTS.test(text);
  if (kids && adults) return 'any';
  if (kids) return 'kids';
  if (adults) return 'adults';
  return 'any';
}

export function detectLanguage(text: string): PoolLanguage {
  const uk = (text.match(/[іїєґІЇЄҐ]/g)?.length ?? 0) + (text.match(/(?<![\p{L}])(?:що|щоб|які|для\s+вас|ваш|вашу|запрошуємо)(?![\p{L}])/giu)?.length ?? 0);
  const ru = (text.match(/[ыэъёЫЭЪЁ]/g)?.length ?? 0) + (text.match(/(?<![\p{L}])(?:что|чтобы|которые|для\s+вас|ваш|приглашаем)(?![\p{L}])/giu)?.length ?? 0);
  return ru > uk ? 'ru' : 'uk';
}

const pad = (value: number) => String(value).padStart(2, '0');
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Термін актуальності: «до Нового року» — 31.12, назва місяця — кінець місяця, «до 25 грудня» і «до 25.12» — ця дата; найближча така дата не раніше `today`. */
export function detectUntil(text: string, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const dates: string[] = [];
  const upcoming = (month: number, day?: number) => {
    const target = (y: number) => `${y}-${pad(month)}-${pad(day ?? lastDay(y, month))}`;
    return target(year) >= today ? target(year) : target(year + 1);
  };
  if (NEW_YEAR.test(text)) dates.push(upcoming(12, 31));
  for (const [month, name] of MONTH_GENITIVE) {
    const dated = text.match(new RegExp(`до\\s+(\\d{1,2})\\s+${name}`, 'iu'));
    if (dated && Number(dated[1]) >= 1 && Number(dated[1]) <= lastDay(year, month)) dates.push(upcoming(month, Number(dated[1])));
  }
  const numeric = text.match(/до\s+(\d{1,2})[./](\d{1,2})(?![\d])/iu);
  if (numeric && Number(numeric[2]) >= 1 && Number(numeric[2]) <= 12 && Number(numeric[1]) >= 1 && Number(numeric[1]) <= 31) dates.push(upcoming(Number(numeric[2]), Number(numeric[1])));
  for (const [month, pattern] of MONTHS) if (pattern.test(text)) dates.push(upcoming(month));
  return dates.length ? dates.sort()[0] : null;
}

const textLen = (value: string) => Array.from(value).length;
/** Основа для порівняння дублів: лише літери й цифри без регістру, емодзі й розділових знаків. */
export function poolDedupeKey(text: string): string {
  return text.toLocaleLowerCase('uk-UA').replace(/[^\p{L}\p{N}]+/gu, '');
}
function trigrams(key: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index + 3 <= key.length; index += 1) result.add(key.slice(index, index + 3));
  return result;
}
function similarity(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let shared = 0;
  for (const item of small) if (large.has(item)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}
export const POOL_NEAR_DUPLICATE = 0.9;

/** Чи текст дублює один із відомих (точно або на ≥ 90 %): повертає індекс першого збігу. */
export function findDuplicate(key: string, grams: Set<string>, known: ReadonlyArray<{ key: string; grams: Set<string> }>): { at: number; exact: boolean } | null {
  for (let at = 0; at < known.length; at += 1) {
    if (known[at].key === key) return { at, exact: true };
    const a = known[at].key.length; const b = key.length;
    if (Math.min(a, b) / Math.max(a, b) < 0.8) continue;
    if (similarity(known[at].grams, grams) >= POOL_NEAR_DUPLICATE) return { at, exact: false };
  }
  return null;
}
export function poolGrams(text: string) { const key = poolDedupeKey(text); return { key, grams: trigrams(key) }; }

const AUTHOR_LINE = /^\p{L}(?:[\p{L}\p{N}\p{Extended_Pictographic}'’ .-]|\u200d|\uFE0F){0,30}:$/u;
function authorCandidate(line: string): string | null {
  const trimmed = line.trim();
  if (!AUTHOR_LINE.test(trimmed) || trimmed.split(/\s+/).length > 4) return null;
  return trimmed.slice(0, -1).trim();
}

/** Текст оголошення з урахуванням рядків, які власник повернув у перегляді. */
export function poolAdText(ad: Pick<ParsedPoolAd, 'lines' | 'drop'>, restored: ReadonlySet<number> = new Set()): string {
  return cleanText(ad.lines.filter((_, index) => !ad.drop.includes(index) || restored.has(index)).join('\n'));
}
function cleanText(value: string): string {
  return value.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Перші слова оголошення для рядків списку: без емодзі на початку, до `max` символів. */
export function poolSnippet(text: string, max = 64): string {
  const first = text.split('\n').map((line) => line.trim()).find((line) => /[\p{L}\p{N}]/u.test(line)) ?? '';
  const plain = first.replace(/^[^\p{L}\p{N}«"“]+/u, '').trim();
  const chars = Array.from(plain);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : plain;
}

type Segment = { author: string; lines: string[] };

/** Ділить список на оголошення за рядками-авторами, подвійним порожнім рядком чи розділювачем «---». */
function segments(raw: string): { segments: Segment[]; authors: string[] } {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const counts = new Map<string, number>();
  lines.forEach((line) => { const name = authorCandidate(line); if (name) counts.set(name, (counts.get(name) ?? 0) + 1); });
  const top = Math.max(0, ...counts.values());
  const firstContent = lines.find((line) => line.trim());
  const firstAuthor = firstContent ? authorCandidate(firstContent) : null;
  const authors = new Set([...counts].filter(([, count]) => count >= 3 && count >= top * 0.1).map(([name]) => name));
  if (firstAuthor) authors.add(firstAuthor);
  const result: Segment[] = [];
  let current: Segment = { author: '', lines: [] };
  const flush = () => { if (current.lines.some((line) => line.trim())) result.push(current); };
  for (const line of lines) {
    const name = authorCandidate(line);
    if (name && authors.has(name)) { flush(); current = { author: name, lines: [] }; continue; }
    current.lines.push(line);
  }
  flush();
  // Усередині одного автора оголошення розділяють два порожні рядки чи рядок із дефісів/зірочок.
  const split: Segment[] = [];
  for (const segment of result) {
    let part: string[] = [];
    let blanks = 0;
    const emit = () => { if (part.some((line) => line.trim())) split.push({ author: segment.author, lines: part }); part = []; };
    for (const line of segment.lines) {
      if (/^\s*[-=_*~]{3,}\s*$/.test(line)) { emit(); blanks = 0; continue; }
      if (!line.trim()) { blanks += 1; if (blanks >= 2 && part.some((entry) => entry.trim())) { emit(); } else if (blanks < 2) part.push(line); continue; }
      blanks = 0;
      part.push(line);
    }
    emit();
  }
  return { segments: split, authors: [...authors] };
}

/**
 * Розбирає вставлений список. `existing` — тексти, що вже є в пулі (режим «Додати»): оголошення, схожі на них, відкидаються.
 * Відкинуте повертається окремо з причиною, щоб перегляд показав, що саме не потрапило в пул.
 */
export function parsePoolList(raw: string, options: { today: string; existing?: readonly string[]; limit?: number }): PoolParseResult {
  const limit = options.limit ?? POOL_TEXT_LIMIT;
  const { segments: parts, authors } = segments(raw);
  const ads: ParsedPoolAd[] = [];
  const rejected: PoolRejected[] = [];
  const known: Array<{ key: string; grams: Set<string> }> = [];
  const knownIndex: number[] = [];
  const existing = (options.existing ?? []).map(poolGrams);
  let broken = 0;
  for (const part of parts) {
    const lines = part.lines.map((line) => {
      const fixed = line.replace(/\uFFFD+[ \t]*/gu, '');
      broken += (line.match(/\uFFFD/g)?.length ?? 0);
      return fixed;
    });
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const body = cleanText(lines.join('\n'));
    // Службовий заголовок напряму без тексту («Математика», «Логопед») або надто короткий уривок.
    const filled = lines.filter((line) => line.trim());
    if (!body || filled.length <= 2 && filled.every(isDirectionHeading) || body.split(/\s+/).length < 4 && textLen(body) < 40 && !/[.!?…]/.test(body)) {
      if (body) rejected.push({ kind: 'heading', author: part.author, text: body });
      continue;
    }
    const drop = lines.flatMap((line, index) => (isInstagramLine(line) ? [index] : []));
    const base: Pick<ParsedPoolAd, 'lines' | 'drop'> = { lines, drop };
    const text = poolAdText(base);
    if (!text) { rejected.push({ kind: 'empty', author: part.author, text: body }); continue; }
    const length = textLen(text);
    if (length > limit) { rejected.push({ kind: 'too_long', author: part.author, text, length }); continue; }
    const { key, grams } = poolGrams(text);
    const duplicateOfExisting = findDuplicate(key, grams, existing);
    if (duplicateOfExisting) { rejected.push({ kind: 'existing', author: part.author, text }); continue; }
    const duplicate = findDuplicate(key, grams, known);
    if (duplicate) { rejected.push({ kind: duplicate.exact ? 'duplicate' : 'near_duplicate', author: part.author, text, of: knownIndex[duplicate.at] }); continue; }
    const index = ads.length;
    known.push({ key, grams }); knownIndex.push(index);
    ads.push({ index, author: part.author, lines, drop, text, direction: detectDirection(text), audience: detectAudience(text), language: detectLanguage(text), until: detectUntil(text, options.today), length });
  }
  return { ads, rejected, authors, broken };
}
