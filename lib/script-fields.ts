// Поля-шаблони в текстах скриптів: у тексті лежать як `[учень]`, `[дата уроку]`…; в Inspector ліда підставляються з даних
// ліда й уроку. Модуль чистий: ним користуються редактор, перегляд, вкладка «Скрипти» й інструмент перетворення позначок.

export const SCRIPT_FIELDS = [
  { key: 'addressee', token: '[звертання]', label: 'Звертання', hint: 'Ім’я того, кому пишемо: учня чи дорослого за перемикачем' },
  { key: 'student', token: '[учень]', label: 'Учень', hint: 'Ім’я учня' },
  { key: 'adult', token: '[дорослий]', label: 'Дорослий', hint: 'Ім’я дорослого контакту' },
  { key: 'subject', token: '[предмет]', label: 'Предмет', hint: 'Предмет уроку' },
  { key: 'lessonDate', token: '[дата уроку]', label: 'Дата уроку', hint: 'Дата найближчого уроку' },
  { key: 'lessonTime', token: '[час уроку]', label: 'Час уроку', hint: 'Час за Києвом' },
  { key: 'teacher', token: '[вчитель]', label: 'Вчитель', hint: 'Ім’я вчителя' },
  { key: 'lessonPlatform', token: '[платформа уроку]', label: 'Платформа уроку', hint: 'Zoom, Google Meet…' },
  { key: 'lessonLink', token: '[посилання на заняття]', label: 'Посилання на заняття', hint: 'Посилання на зустріч' },
  { key: 'administrator', token: '[адміністратор]', label: 'Адміністратор', hint: 'Ім’я того, хто пише лідові (з профілю)' },
  { key: 'price', token: '[ціна]', label: 'Ціна', hint: 'Ціна за урок: вписується вручну' },
  { key: 'grade', token: '[клас]', label: 'Клас', hint: 'Клас учня: вписується вручну' },
  { key: 'problem', token: '[проблема]', label: 'Проблема', hint: 'Запит, який назвали батьки: вписується вручну' },
] as const;

export type ScriptFieldKey = (typeof SCRIPT_FIELDS)[number]['key'];
export type ScriptValues = Partial<Record<ScriptFieldKey, string>>;
export type ScriptPart =
  | { kind: 'text'; text: string }
  | { kind: 'field'; field: ScriptFieldKey; token: string }
  | { kind: 'unknown'; token: string };

const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase('uk-UA').replace(/[’`ʼ]/g, "'").replace(/\s+/g, ' ').trim();
const BRACKET = /\[([^[\]\n]{1,40})\]/g;
const BY_NAME = new Map<string, ScriptFieldKey>(SCRIPT_FIELDS.map((field) => [normalize(field.token.slice(1, -1)), field.key]));
export const fieldToken = (key: ScriptFieldKey) => SCRIPT_FIELDS.find((field) => field.key === key)!.token;
export const fieldLabel = (key: ScriptFieldKey) => SCRIPT_FIELDS.find((field) => field.key === key)!.label;

/** Текст → частини: звичайний текст, відоме поле чи невідома позначка в дужках. */
export function parseScript(text: string): ScriptPart[] {
  const parts: ScriptPart[] = [];
  let last = 0;
  for (const match of text.matchAll(BRACKET)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) });
    const field = BY_NAME.get(normalize(match[1]));
    parts.push(field ? { kind: 'field', field, token: match[0] } : { kind: 'unknown', token: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

/** Поля, які зустрічаються в тексті (без повторів, у порядку появи). */
export function fieldsIn(text: string): ScriptFieldKey[] {
  return [...new Set(parseScript(text).flatMap((part) => (part.kind === 'field' ? [part.field] : [])))];
}

/** Готовий текст: відомі поля замінені значеннями; поле без значення лишається позначкою, невідомі дужки не чіпаємо. */
export function fillScript(text: string, values: ScriptValues): { text: string; missing: ScriptFieldKey[] } {
  const missing = new Set<ScriptFieldKey>();
  const out = parseScript(text).map((part) => {
    if (part.kind !== 'field') return part.kind === 'text' ? part.text : part.token;
    const value = values[part.field]?.trim();
    if (value) return value;
    missing.add(part.field);
    return part.token;
  }).join('');
  return { text: out, missing: [...missing] };
}

/** Вставка позначки поля в текст у позиції курсора (виділене замінюється). */
export function insertField(text: string, from: number, to: number, key: ScriptFieldKey): { text: string; caret: number } {
  const token = fieldToken(key);
  return { text: `${text.slice(0, from)}${token}${text.slice(to)}`, caret: from + token.length };
}

// Старі позначки в дужках, які власник писав у текстах скриптів, → поле. Порівняння без регістру й апострофів.
const ALIASES: Record<ScriptFieldKey, readonly string[]> = {
  addressee: ["ім'я", 'імя', 'имя', "ім'я клієнта", 'імя клієнта', 'имя клиента', 'клієнт', 'клиент', 'звертання', 'обращение'],
  student: ['учень', 'учня', "ім'я учня", 'імя учня', 'ученик', 'имя ученика', 'дитина', "ім'я дитини", 'імя дитини', 'ребенок', 'имя ребенка', 'студент'],
  adult: ['дорослий', 'доросла', "ім'я дорослого", 'імя дорослого', 'батьки', 'мама', 'тато', "ім'я батьків", "ім'я мами", 'взрослый', 'родитель', 'имя родителя'],
  subject: ['предмет', 'предмета', 'предмет уроку', 'предмет заняття', 'предмет урока', 'дисципліна', 'напрямок', 'напрям', 'направление', 'мова', 'язык'],
  lessonDate: ['дата', 'дата уроку', 'дата заняття', 'дата урока', 'день', 'дата пробного', 'дата пробного уроку', 'дата пробного заняття'],
  lessonTime: ['час', 'час уроку', 'час заняття', 'время', 'время урока', 'час пробного', 'час пробного уроку'],
  teacher: ['вчитель', 'вчителька', 'викладач', 'викладачка', 'преподаватель', "ім'я вчителя", 'імя вчителя', 'имя преподавателя', 'педагог'],
  lessonPlatform: ['платформа', 'платформа уроку', 'платформа заняття', 'платформа зустрічі', 'платформа урока', 'платформа проведення'],
  administrator: ['адміністратор', 'адміністраторка', 'оператор', "ім'я адміністратора", 'імя адміністратора', 'имя администратора', 'мене звати'],
  price: ['ціна', 'цена', 'вартість', 'стоимость', 'сума'],
  grade: ['клас', 'класс'],
  problem: ['проблема', 'запит', 'запрос', 'проблему'],
  lessonLink: ['посилання', 'посилання на заняття', 'посилання на урок', 'посилання на зустріч', 'лінк', 'link', 'ссылка', 'ссылка на занятие', 'ссылка на урок', 'url'],
};
const ALIAS_INDEX = new Map<string, ScriptFieldKey>();
for (const [key, names] of Object.entries(ALIASES) as Array<[ScriptFieldKey, readonly string[]]>) for (const name of names) ALIAS_INDEX.set(normalize(name), key);

/** Яке поле відповідає старій позначці `[…]`; `null`, якщо не розпізнано. Уже відомі поля повертаються як є. */
export function suggestField(inner: string): ScriptFieldKey | null {
  const name = normalize(inner);
  return BY_NAME.get(name) ?? ALIAS_INDEX.get(name) ?? null;
}

/** Позначки в дужках, які ще не є полями: кандидати на перетворення. */
export function legacyBrackets(text: string): Array<{ token: string; inner: string; field: ScriptFieldKey | null }> {
  const seen = new Set<string>();
  const found: Array<{ token: string; inner: string; field: ScriptFieldKey | null }> = [];
  for (const part of parseScript(text)) {
    if (part.kind !== 'unknown' || seen.has(part.token)) continue;
    seen.add(part.token);
    const inner = part.token.slice(1, -1);
    found.push({ token: part.token, inner, field: suggestField(inner) });
  }
  return found;
}

const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
/** `2026-10-17` → «17 жовтня». */
export function lessonDateLabel(date: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? ''}`.trim() : '';
}

// Вбудовані шаблони: створюються кнопкою «Стандартні шаблони» (без неї база порожня, а віддалені дані я не чіпаю).
export const TEMPLATE_SCRIPTS = [
  {
    key: 'lesson_booked', stage: 'booked', title: 'Записали вас на урок',
    ukText: 'Добрий день, [звертання]. Записали на пробний урок: [предмет], [дата уроку] о [час уроку] (за Києвом). Вчитель: [вчитель]. Урок пройде на платформі [платформа уроку], посилання: [посилання на заняття]. Якщо щось зміниться, напишіть нам.',
    ruText: 'Добрый день, [звертання]. Записали на пробный урок: [предмет], [дата уроку] в [час уроку] (по Киеву). Преподаватель: [вчитель]. Урок пройдет на платформе [платформа уроку], ссылка: [посилання на заняття]. Если что-то изменится, напишите нам.',
  },
  {
    key: 'reminder_day', stage: 'reminder', title: 'Нагадування за день',
    ukText: 'Добрий день, [звертання]. Нагадуємо: завтра, [дата уроку] о [час уроку] (за Києвом), урок — [предмет], вчитель [вчитель]. Платформа: [платформа уроку], посилання: [посилання на заняття]. Підтвердьте, будь ласка, що все в силі.',
    ruText: 'Добрый день, [звертання]. Напоминаем: завтра, [дата уроку] в [час уроку] (по Киеву), урок — [предмет], преподаватель [вчитель]. Платформа: [платформа уроку], ссылка: [посилання на заняття]. Подтвердите, пожалуйста, что все в силе.',
  },
  {
    key: 'reminder_hour', stage: 'reminder', title: 'Нагадування за годину',
    ukText: '[звертання], нагадуємо: за годину, о [час уроку], починається урок — [предмет], вчитель [вчитель]. Посилання: [посилання на заняття]. До зустрічі.',
    ruText: '[звертання], напоминаем: через час, в [час уроку], начинается урок — [предмет], преподаватель [вчитель]. Ссылка: [посилання на заняття]. До встречи.',
  },
] as const;
