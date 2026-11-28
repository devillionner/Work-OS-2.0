// Порівняння назви чату з Work OS і тексту, прочитаного OCR зі знімка вікна месенджера (Viber Desktop на Windows, 3.22.0).
// OCR (ru-RU і en-US; української немає) плутає і/ї/є/ґ, кирилицю з латиницею, губить прапори й емодзі та додає сміття на краях смуги, тому
// токенна схожість із `lib/name-similarity.ts` (частка спільних слів) тут не годиться: одна помилка в літері ламає слово цілком. Замість неї:
// «скелет» назви (регістр, емодзі, знаки, і/ї/є/ґ/й/ы/ь, латинські двійники кирилиці зведено до спільної форми) і відстань Левенштейна з допуском
// на сміття по краях та на обрізання «…» у списку. Поріг збігу — не нижче 0.8 (`OCR_MATCH_THRESHOLD`).
export const OCR_MATCH_THRESHOLD = 0.8;
/** Короткі назви («Temu») OCR читає ненадійно: підтверджуються лише точним збігом скелета. */
export const OCR_MIN_NAME_LENGTH = 5;

// «n» en-OCR дає і для «п», і для «и», і для «л» («Kawnpcb» — Каширсь, «TonbK0» — Только, «naca» — Паса): окремий знак, що дорівнює будь-якій
// із них (`sameChar`). Обидві сторони проходять ту саму заміну, тож латинська назва («Berlin») порівнюється сама з собою, як і раніше.
const N_ANY = 'ⁿ';
const N_ANY_OF = 'пил';
const LATIN_TO_CYRILLIC = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', i: 'и', k: 'к', l: 'и', m: 'м', n: N_ANY, o: 'о', p: 'р', r: 'г', t: 'т', u: 'и', w: 'ш', x: 'х', y: 'у' };
// Цифри всередині слова з літерами — це літери, прочитані OCR як цифри («1нфоблок», «3аробітчани», «Бе6рцы»); окремі числа («18+», «2026») лишаються.
const DIGIT_AS_LETTER = { 0: 'о', 1: 'и', 3: 'з', 4: 'ч', 6: 'б' };
const CYRILLIC_REDUCE = { ё: 'е', й: 'и', ы: 'и', э: 'е', є: 'е', ї: 'и', і: 'и', ґ: 'г' };

/** Хвости, що Work OS додає до назви, а месенджер не показує: «в Viber», «[чат]». */
function stripTails(value) {
  return String(value || '')
    .replace(/[\s\-–—([]*(?:(?<![\p{L}\p{N}])(?:в|у|in|на|для|for)\s+)?(?<![\p{L}\p{N}])viber[)\]]*\s*$/iu, '')
    .replace(/[\s\-–—]*[([]\s*чат\s*[)\]]\s*$/iu, '');
}

/**
 * Латинські двійники кирилиці, які en-OCR дає послідовностями й лише в певному регістрі (знімки Viber Desktop 2026-11-27):
 * «ш» → «w», «1D», «11D», «LLI» («Ka1DVIPCbKVIV1» — Каширський, «KY11DYIHeBi» — Кишиневі); «и»/«й» → «VI», «YI», «V1»; «ы» → «bI»;
 * мала «b» — це «ь» (велика «B» — «В», лишається «в»); «+» перед літерою — «ф» («+axiB14i» — фахівці). У кириличній назві з Work OS таких
 * послідовностей немає, латинська проходить ту саму заміну з обох боків.
 */
function latinLookalikes(value) {
  return value
    .replace(/(?:11|1|LL)D|LLI/g, 'ш')
    .replace(/[VY][I1l]|b[I1l]/g, 'и')
    .replace(/b/g, 'ь')
    .replace(/\+(?=\p{L})/gu, 'ф');
}

/**
 * Спільна форма назви для порівняння з шумом OCR: лише літери й цифри, кирилиця без і/ї/є/ґ/й/ы/ь, латинські двійники — кирилицею.
 * `fixDigits` (лише для прочитаного): цифри всередині слова з літерами — це літери («14» — «ц»). `dropGluedDigits`: решту таких цифр прибрати —
 * коли в очікуваній назві цифр немає, цифра, приліплена до слова («KYIV1», «cnp8» від емодзі), — сміття OCR, а не номер чату.
 */
export function nameSkeleton(value, { fixDigits = false, dropGluedDigits = false } = {}) {
  let lower = latinLookalikes(stripTails(value).normalize('NFC').replace(/[’'`ʼ]/gu, '')).toLocaleLowerCase('uk-UA');
  // «JI» латиницею — це «Л» кирилиці, «q» — «ч» (типові помилки en-OCR); застосовується до обох сторін.
  lower = lower.replace(/j[il]/gu, 'л').replace(/q/gu, 'ч');
  if (fixDigits) {
    lower = lower.replace(/[\p{L}\p{N}]+/gu, (word) => {
      if (!/\p{L}/u.test(word)) return word;
      const fixed = word.replace(/14/g, 'ц').replace(/[01346]/gu, (digit) => DIGIT_AS_LETTER[digit]);
      return dropGluedDigits ? fixed.replace(/\p{N}/gu, '') : fixed;
    });
  }
  let out = '';
  for (const char of lower) {
    if (char === 'ь' || char === 'ъ') continue;
    const mapped = CYRILLIC_REDUCE[char] || LATIN_TO_CYRILLIC[char] || char;
    if (/[\p{L}\p{N}]/u.test(mapped)) out += mapped;
  }
  return out;
}

const sameChar = (x, y) => x === y || (x === N_ANY && N_ANY_OF.includes(y)) || (y === N_ANY && N_ANY_OF.includes(x));

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (sameChar(a[i - 1], b[j - 1]) ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

const ratio = (a, b) => (a.length || b.length ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 0);
const digitRuns = (value) => (String(value).match(/\d+/g) || []).sort().join(',');

/** Рядки підзаголовка шапки («1,451 members», «15 учасників», «online») — не назва чату. */
const SUBTITLE = /(members?|участник|учасник|підписник|подписчик|online|в мережі|last seen|був\(ла\)|\bmin\b|\bhr\b)/iu;

/** Назва з одного результату OCR: перші рядки без підзаголовка. */
export function nameFromOcr(text, lines = 2) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !SUBTITLE.test(line)).slice(0, lines).join(' ').trim();
}

/** Оцінка однієї пари «очікувана назва — прочитаний текст». `truncated`: у списку довга назва закінчується «…» (порівнюємо з початком). */
export function scoreOcrName(expected, observed, lines = 2) {
  const raw = nameFromOcr(observed, lines);
  const truncated = /(…|\.{2,})\s*$/u.test(raw);
  const target = nameSkeleton(expected);
  const read = nameSkeleton(raw, { fixDigits: true, dropGluedDigits: !/\d/.test(target) });
  if (!target || read.length < 3) return { score: 0, read, truncated, short: target.length < OCR_MIN_NAME_LENGTH };
  const short = target.length < OCR_MIN_NAME_LENGTH;
  // Список чатів обрізає довгі назви: порівнюємо з початком очікуваної назви тієї ж довжини (+1 символ на помилку OCR).
  const comparable = truncated ? target.slice(0, Math.min(target.length, read.length + 1)) : target;
  // Допуск на сміття по краях смуги (прапор, аватар, обрізана літера): до 3 символів зліва й справа, із невеликим штрафом за кожен.
  let best = 0;
  const limit = truncated ? 2 : 3;
  for (let left = 0; left <= limit; left += 1) {
    for (let right = 0; right <= limit; right += 1) {
      if (left + right >= read.length - 2) continue;
      const trimmed = read.slice(left, read.length - right);
      const candidate = ratio(trimmed, comparable) - 0.03 * (left + right);
      if (candidate > best) best = candidate;
    }
  }
  let score = Math.max(0, best);
  // Цифри в назві (рік, номер, «18+») мусять збігатися, інакше це інший чат («Група 1» і «Група 2»).
  if (digitRuns(comparable) !== digitRuns(read)) score = Math.min(score, 0.6);
  // Дуже коротку назву підтверджує лише точний збіг (OCR читає «Temu» як «эти»).
  if (short && read !== comparable) score = Math.min(score, 0.5);
  return { score: Math.round(score * 1000) / 1000, read, truncated, short };
}

/**
 * Найкраща оцінка серед усіх результатів OCR смуги (мови × нормальний/інвертований варіант).
 * @param {string} expected назва чату з Work OS
 * @param {{text?: string, lang?: string, inverted?: boolean}[]} texts
 * @returns {{score:number, observed:string, lang:string, inverted:boolean, truncated:boolean, short:boolean, matched:boolean}}
 */
export function bestOcrMatch(expected, texts, { lines = 2 } = {}) {
  let best = { score: 0, observed: '', lang: '', inverted: false, truncated: false, short: false };
  for (const item of texts || []) {
    const result = scoreOcrName(expected, item?.text || '', lines);
    if (result.score > best.score || (!best.observed && nameFromOcr(item?.text, lines))) {
      if (result.score >= best.score) best = { score: result.score, observed: nameFromOcr(item?.text, lines), lang: item?.lang || '', inverted: Boolean(item?.inverted), truncated: result.truncated, short: result.short };
    }
  }
  return { ...best, matched: best.score >= OCR_MATCH_THRESHOLD };
}

/** Що показати як «прочитано» (observedTarget): назва з першого непорожнього результату кирилицею. */
export function observedFromOcr(texts, lines = 2) {
  const ordered = [...(texts || [])].sort((x, y) => Number(x.inverted) - Number(y.inverted) || (x.lang === 'ru-RU' ? -1 : 1) - (y.lang === 'ru-RU' ? -1 : 1));
  for (const item of ordered) {
    const name = nameFromOcr(item.text, lines);
    if (name) return name;
  }
  return '';
}

/**
 * Збіг за словами (3.22.10). ru-OCR губить українські слова з «і/ї/є» («Віддам Продам Недорого» → «Продам Недорого»), en-OCR читає їх латиницею
 * («XapKiB»), тож повна назва часто не набирає 0.8, хоча чат правильний. Слова (≥ 3 літери скелета) зіставляються один до одного (одне прочитане
 * слово закриває лише одне слово назви; схожість ≥ 0.7, для слів до 4 літер ≥ 0.75). Збіг — коли закриті слова дають ≥ 60 % літер назви, їх
 * щонайменше два, і хоча б один результат OCR сам на ≥ 75 % складається зі слів цієї назви («Робота в Чехії Прага» ≠ «Чехия Работа / Робота»).
 * @returns {{matched:boolean, coverage:number, words:number}}
 */
export function wordCoverMatch(expected, texts) {
  const split = (value, options) => String(value || '').split(/[^\p{L}\p{N}]+/u).map((word) => nameSkeleton(word, options)).filter((word) => word.length >= 3);
  const target = split(stripTails(expected));
  if (target.length < 2) return { matched: false, coverage: 0, words: 0 };
  // Цифри назви (рік, номер) мусять збігатися, як і в `scoreOcrName`: окремі числа слова не дають (< 3 знаків), тож «Група 1» і «Група 2» інакше
  // збігалися б словами. Результат OCR з іншими числами не рахується ні «чистим», ні «початком назви».
  const wantDigits = digitRuns(nameSkeleton(expected));
  const readOptions = { fixDigits: true, dropGluedDigits: !wantDigits };
  const items = (texts || []).map((item) => {
    const text = stripTails(String(item?.text || '').split(/\r?\n/).filter((line) => !SUBTITLE.test(line)).join(' '));
    return Object.assign(split(text, readOptions), { digitsOk: digitRuns(nameSkeleton(text, readOptions)) === wantDigits });
  }).filter((words) => words.length);
  const near = (a, b) => ratio(a, b) >= (Math.min(a.length, b.length) <= 4 ? 0.75 : 0.7);
  /** Пари «прочитане слово → слово назви» один до одного, найсхожіші спершу. Повертає індекси закритих слів назви. */
  const assign = (seen) => {
    const pairs = [];
    seen.forEach((word, i) => target.forEach((goal, j) => { if (near(word, goal)) pairs.push([ratio(word, goal), i, j]); }));
    pairs.sort((a, b) => b[0] - a[0]);
    const usedSeen = new Set();
    const usedGoal = new Set();
    for (const [, i, j] of pairs) { if (!usedSeen.has(i) && !usedGoal.has(j)) { usedSeen.add(i); usedGoal.add(j); } }
    return usedGoal;
  };
  const hits = assign(items.flat());
  const total = target.reduce((sum, word) => sum + word.length, 0);
  const coverage = [...hits].reduce((sum, j) => sum + target[j].length, 0) / total;
  const clean = items.some((words) => words.digitsOk && words.length >= 2 && assign(words).size / words.length >= 0.75);
  // «Початок назви»: якийсь результат OCR цілком складається зі слів назви й містить її перше слово (OCR обірвав рядок на прапорцях чи «і»:
  // «ВСІ СПІЛЬНОТИ🇺🇦🇺🇦🇺🇦УКРАЇНИ» → «BCI»). Сам по собі не доказ; лише разом із чатом, відкритим його власним запрошенням (viber-desktop.mjs).
  const prefix = items.some((words) => { const got = assign(words); return words.digitsOk && got.size === words.length && got.has(0); });
  return { matched: coverage >= 0.6 && hits.size >= 2 && clean, coverage: Math.round(coverage * 1000) / 1000, words: hits.size, prefix };
}

/**
 * «Явно інша назва» (3.24.4): у прочитаному тексті є щонайменше два надійно прочитані слова (≥ 4 літери, кирилицею; латиницею — лише коли сама
 * назва має латинські слова), не схожі на жодне слово назви (схожість < 0.5 і без спільного початку з 4 літер), і вони дають ≥ 40 % літер
 * рядка. Латинська «каша» en-OCR з кириличної назви («KaMiHb», «OnepeBi3HYIK») надійною не вважається: це спотворена назва, а не інша.
 * Вето для приблизного збігу за запрошенням: «🩷МОДНА КІМНАТА 🩷жіночий одяг» замість «DRESS CODE 🇮🇹жіночий одяг» (3.16.7) — інший чат,
 * хоч половина слів збігається; «Только для одесситов — здесь свои» замість «Мамы Одессы».
 * @returns {{conflict:boolean, foreign:string[]}} foreign — усі надійні чужі слова (≥ 4 літери) з усіх текстів
 */
export function ocrNameForeignWords(expected, texts, { substitution = false } = {}) {
  const name = stripTails(expected);
  const goals = String(name).split(/[^\p{L}\p{N}]+/u).map((word) => nameSkeleton(word)).filter((word) => word.length >= 3);
  const latinName = /\p{Script=Latin}{3,}/u.test(name);
  const reliable = (raw) => {
    if (/\p{N}/u.test(raw)) return false;
    const cyr = (raw.match(/\p{Script=Cyrillic}/gu) || []).length;
    const lat = (raw.match(/\p{Script=Latin}/gu) || []).length;
    return cyr / (cyr + lat) >= 0.6 || (latinName && lat > 0 && cyr === 0);
  };
  const resembles = (word) => goals.some((goal) => ratio(word, goal) >= 0.5 || (word.length >= 4 && goal.includes(word.slice(0, 4))) || (goal.length >= 4 && word.includes(goal.slice(0, 4))));
  const foreign = [];
  let conflict = false;
  for (const item of texts || []) {
    const text = stripTails(String(item?.text || '').split(/\r?\n/).filter((line) => !SUBTITLE.test(line)).join(' '));
    let total = 0;
    let alien = 0;
    let count = 0;
    const seen = [];
    for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
      const word = nameSkeleton(raw, { fixDigits: true });
      if (word.length < 3) continue;
      total += word.length;
      seen.push(word);
      if (word.length >= 4 && reliable(raw) && !resembles(word)) { alien += word.length; count += 1; foreign.push(raw); }
    }
    if (count >= 2 && alien / total >= 0.4) conflict = true;
    // Заміна слова: надійне чуже слово стоїть там, де слова назви немає («Барахолка Київ» замість «Барахолка Харків»). Лише для рядків, що й
    // справді є назвою (`substitution`: шапка розмови, рядок вікна вступу, що найкраще збігся), бо в рядку тла за вікном немає жодного слова назви.
    const uncovered = goals.some((goal) => goal.length >= 4 && !seen.some((word) => ratio(word, goal) >= 0.5));
    if (substitution && count >= 1 && uncovered && seen.length > count) conflict = true;
  }
  return { conflict, foreign };
}

/** Вето «явно інша назва» для приблизного збігу шапки розмови, відкритої власним запрошенням (див. `ocrNameForeignWords`). */
export function ocrNameConflict(expected, texts) {
  return ocrNameForeignWords(expected, texts, { substitution: true }).conflict;
}

/** Рядок «2,574 members» у вікні вступу Viber: назва спільноти стоїть безпосередньо над ним (між ними лише аватар без тексту). */
const MEMBERS_LINE = /\d.*(members?|учасник|участник|підписник|подписчик)/iu;

/**
 * Вікно вступу Viber Desktop («Join Community»; назву UIA не віддає, читаємо OCR середини вікна рядками). `lines` — рядки всіх результатів OCR
 * (`{text, lang, inverted}`, у порядку кожного результату). Сувора перевірка — повна назва ≥ 0.8 у будь-якому рядку чи склейці 2–3 сусідніх
 * (довга назва переноситься). Інакше, як і для розмови, відкритої власним запрошенням (3.22.11): вікно відкрило НАШЕ унікальне посилання, тож
 * досить приблизного збігу саме назви (рядки над «N members», а не опис чи тло за вікном) — схожість ≥ 0.6, збіг за словами, «початок назви»
 * чи ≥ 40 % слів без жодного чужого надійного слова, — і щоб назва не була явно іншою (`ocrNameForeignWords`).
 * @returns {{matched:boolean, how:string, score:number, coverage:number, conflict:boolean, observed:string}}
 */
export function joinDialogMatch(expected, lines) {
  const groups = new Map();
  for (const line of lines || []) {
    const key = `${line?.lang || ''}|${line?.inverted ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }
  const joined = (part) => [{ ...part[0], text: part.map((t) => t.text).join(' ') }, { ...part[0], text: part.map((t) => t.text).join('') }];
  const all = [];
  const title = [];
  const near = [];
  for (const group of groups.values()) {
    all.push(...group);
    for (let i = 0; i < group.length; i += 1) for (let span = 2; span <= 3 && i + span <= group.length; span += 1) all.push(...joined(group.slice(i, i + span)));
    const members = group.findIndex((line) => MEMBERS_LINE.test(String(line?.text || '')));
    for (let span = 1; span <= 3 && members - span >= 0; span += 1) {
      const part = group.slice(members - span, members);
      title.push(...(span === 1 ? part : joined(part)));
      if (span <= 2) near.push(span === 1 ? part[0] : joined(part)[0]);
    }
  }
  const strict = bestOcrMatch(expected, all, { lines: 1 });
  if (strict.matched) return { matched: true, how: 'strict', score: strict.score, coverage: 0, conflict: false, observed: strict.observed };
  if (!title.length) return { matched: false, how: 'no-title', score: strict.score, coverage: 0, conflict: false, observed: strict.observed };
  const match = bestOcrMatch(expected, title, { lines: 1 });
  const words = wordCoverMatch(expected, title);
  // Вето перевіряємо на рядку над «members», на двох рядках над ним (назва в два рядки) і на рядку, що найкраще збігся.
  const best = title.find((line) => nameFromOcr(line.text, 1) === match.observed);
  const { foreign, conflict: nearConflict } = ocrNameForeignWords(expected, best ? [...near, best] : near);
  const conflict = nearConflict || Boolean(best && ocrNameForeignWords(expected, [best], { substitution: true }).conflict);
  const how = match.score >= 0.6 ? 'score' : words.matched ? 'words' : words.prefix ? 'prefix' : words.coverage >= 0.4 && !foreign.length ? 'coverage' : '';
  return { matched: Boolean(how) && !conflict, how: how || 'none', score: match.score, coverage: words.coverage, conflict, observed: match.observed || strict.observed };
}
