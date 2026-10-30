// Сид публічної демо-версії: усі дані вигадані, детерміновані й рахуються від «сьогодні» (мітка @T у SQL = північ за Києвом у момент скидання).
// Нічого зі staging не копіюється; посилання неіснуючі (`t.me/demo_…`, `chat.whatsapp.com/DEMO…`). Результат — масив SQL-рядків без параметрів:
// воркер замінює @T на число й виконує їх одним `batch`, конвеєр розгортання — через `wrangler d1 execute --file`.
import { createHash } from 'node:crypto';
import { DEMO_EMAIL, DEMO_NAME, DEMO_SESSION_TOKEN, DEMO_USER_ID } from '../lib/demo.ts';
import { TEMPLATE_SCRIPTS } from '../lib/script-fields.ts';

const DAY = 86400;
const U = DEMO_USER_ID;

/** Таблиці, що стираються першими: найбільші та ті, на які посилаються інші, щоб не спрацьовували зайві каскади. */
export const WIPE_FIRST = [
  'activity_daily_counts', 'activity_day_revisions', 'chat_queue_counts', 'chat_event_summary', 'autopost_day_counts',
  'activity_events', 'chat_publications', 'telegram_schedule_slots', 'telegram_schedule_settings', 'lead_message_attachment_chunks',
  'lead_message_attachments', 'lead_messages', 'lesson_reminders', 'curator_requests', 'lessons', 'student_subjects', 'students', 'lead_commands',
  'leads', 'chat_profiles', 'chats', 'library_item_versions', 'library_items', 'dev_items', 'daily_reports', 'report_checkpoints',
  'workday_pauses', 'workdays', 'work_timers', 'goal_versions', 'user_settings', 'telegram_accounts', 'sessions', 'backup_revisions',
];

// ---------------------------------------------------------------- допоміжне

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261019);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
const chance = (p) => rand() < p;
function weighted(pairs) {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let x = rand() * total;
  for (const [value, w] of pairs) { x -= w; if (x <= 0) return value; }
  return pairs[pairs.length - 1][0];
}

class Raw { constructor(sql) { this.sql = sql; } }
const raw = (sql) => new Raw(sql);
/** Секунди від «сьогодні 00:00 Київ»: day — зсув у добах (від'ємний — минуле), sec — секунди доби. */
const ts = (day, sec = 0) => { const off = day * DAY + sec; return raw(off === 0 ? '@T' : off > 0 ? `@T+${off}` : `@T${off}`); };
/** Календарна дата (Київ) через SQL, щоб не залежати від моменту генерації. */
const dt = (day) => { const off = day * DAY + 43200; return raw(`date(@T${off >= 0 ? '+' : ''}${off},'unixepoch')`); };
const lit = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Raw) return value.sql;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
};

const statements = [];
function insert(table, columns, rows, { ignore = false, chunk = 60 } = {}) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk).map((row) => `(${columns.map((column) => lit(row[column])).join(',')})`);
    statements.push(`INSERT ${ignore ? 'OR IGNORE ' : ''}INTO ${table} (${columns.join(',')}) VALUES ${part.join(',')}`);
  }
}
const sql = (text) => statements.push(text);

// ---------------------------------------------------------------- словники (вигадані)

const CITIES = ['Берлін', 'Мюнхен', 'Гамбург', 'Кельн', 'Франкфурт', 'Штутгарт', 'Дюссельдорф', 'Лейпциг', 'Дрезден', 'Варшава', 'Краків', 'Вроцлав',
  'Прага', 'Брно', 'Відень', 'Грац', 'Цюрих', 'Базель', 'Амстердам', 'Роттердам', 'Брюссель', 'Антверпен', 'Париж', 'Ліон', 'Мадрид', 'Барселона',
  'Валенсія', 'Лісабон', 'Мілан', 'Рим', 'Болонья', 'Дублін', 'Копенгаген', 'Стокгольм', 'Осло', 'Гельсінкі', 'Таллінн', 'Рига', 'Вільнюс',
  'Братислава', 'Будапешт', 'Бухарест', 'Софія', 'Афіни'];
const NAME_TEMPLATES = ['Українці у {c}', '{c}: допомога і поради', 'Робота та підробіток · {c}', 'Діти і школа · {c}', 'Оголошення · {c}',
  'Українська спільнота {c}', 'Мами {c}', 'Переїзд до {c}', 'Навчання та курси · {c}'];
const F_NAMES = ['Олена', 'Марія', 'Ірина', 'Наталія', 'Оксана', 'Тетяна', 'Юлія', 'Анна', 'Світлана', 'Катерина', 'Людмила', 'Вікторія', 'Діана', 'Софія', 'Алла', 'Галина', 'Яна', 'Леся'];
const M_NAMES = ['Андрій', 'Олександр', 'Максим', 'Дмитро', 'Сергій', 'Богдан', 'Ігор', 'Роман', 'Василь', 'Тарас', 'Михайло', 'Олег', 'Павло', 'Віктор'];
const SURNAMES = ['Коваленко', 'Шевчук', 'Бондар', 'Мельник', 'Ткачук', 'Кравець', 'Лисенко', 'Мороз', 'Савчук', 'Гриценко', 'Петрик', 'Руденко', 'Поліщук', 'Назарук', 'Яременко', 'Остапенко', 'Дорошенко', 'Бойко', 'Кучер', 'Марчук'];
const KIDS_F = ['Софія', 'Єва', 'Злата', 'Мілана', 'Аліса', 'Варвара', 'Дарина', 'Поліна', 'Емілія', 'Христина'];
const KIDS_M = ['Артем', 'Данило', 'Нікіта', 'Матвій', 'Тимофій', 'Лев', 'Захар', 'Марк', 'Назар', 'Ілля'];
const SUBJECTS = [['Англійська', 28], ['Математика', 24], ['Німецька', 12], ['Польська', 8], ['Шкільні предмети — комплексно', 10], ['Малювання', 6], ['ІТ', 6], ['Логопедія та дефектологія', 4], ['Шахи', 2]];
const TEACHERS = ['Ірина Савчук', 'Олег Мартин', 'Наталія Гнатюк', 'Дмитро Кравчук', 'Юлія Пономаренко', 'Андрій Лозинський'];
const PLATFORM_MIX = [['telegram', 62], ['whatsapp', 22], ['viber', 12], ['facebook', 4]];

function fullName(female) { return `${pick(female ? F_NAMES : M_NAMES)} ${pick(SURNAMES)}`; }

// ---------------------------------------------------------------- користувач, сесія, налаштування

const tokenHash = createHash('sha256').update(DEMO_SESSION_TOKEN).digest('hex');
insert('users', ['id', 'email', 'display_name', 'picture_url', 'created_at', 'last_login_at'], [{ id: U, email: DEMO_EMAIL, display_name: DEMO_NAME, picture_url: null, created_at: ts(-90), last_login_at: ts(0) }]);
insert('sessions', ['token_hash', 'user_id', 'created_at', 'expires_at'], [{ token_hash: tokenHash, user_id: U, created_at: ts(-90), expires_at: ts(3650) }]);

const settings = {
  enabled_platforms: ['telegram', 'whatsapp', 'viber', 'facebook'],
  focus_directions: ['Англійська', 'Математика', 'Німецька'],
  daily_booking_goal: 2,
  monthly_booking_goal: 40,
  target_publication_rate: 60,
  target_response_rate: 12,
  target_booking_rate: 30,
  target_completion_rate: 80,
  'analytics-daily-goal-schedule-v1': { defaultGoal: { ads: 12, chats: 4, responses: 3, records: 2 }, periods: [], overrides: {} },
};
insert('user_settings', ['user_id', 'setting_key', 'value_json', 'updated_at'], Object.entries(settings).map(([key, value]) => ({ user_id: U, setting_key: key, value_json: JSON.stringify(value), updated_at: ts(-30) })));
insert('goal_versions', ['id', 'user_id', 'goal_key', 'effective_on', 'value', 'created_at', 'source', 'version'], [
  { id: 'demo-goal-daily', user_id: U, goal_key: 'daily_booking_goal', effective_on: dt(-90), value: 2, created_at: ts(-90), source: 'baseline', version: 1 },
  { id: 'demo-goal-monthly', user_id: U, goal_key: 'monthly_booking_goal', effective_on: dt(-90), value: 40, created_at: ts(-90), source: 'baseline', version: 1 },
]);

// ---------------------------------------------------------------- акаунти Telegram

const ACCOUNTS = [
  { id: 'demo-acc-1', n: 1, name: 'Основний акаунт', selected: 1, streak: 3 },
  { id: 'demo-acc-2', n: 2, name: 'Запасний акаунт', selected: 0, streak: 0 },
  { id: 'demo-acc-3', n: 3, name: 'Акаунт для WhatsApp-груп', selected: 0, streak: 0 },
];
insert('telegram_accounts', ['id', 'user_id', 'account_number', 'name', 'is_enabled', 'is_selected', 'join_streak', 'join_batch_size', 'break_minutes', 'break_until', 'created_at', 'updated_at'],
  ACCOUNTS.map((a) => ({ id: a.id, user_id: U, account_number: a.n, name: a.name, is_enabled: 1, is_selected: a.selected, join_streak: a.streak, join_batch_size: 5, break_minutes: 15, break_until: null, created_at: ts(-90), updated_at: ts(-1) })));

// ---------------------------------------------------------------- чати

const chats = [];
const usedNames = new Set();
let chatSeq = 0;
function makeChat(platform, status, extra = {}) {
  chatSeq += 1;
  let name;
  do { name = pick(NAME_TEMPLATES).replace('{c}', pick(CITIES)) + (chance(0.25) ? ` ${between(2, 9)}` : ''); } while (usedNames.has(`${platform}|${name}`));
  usedNames.add(`${platform}|${name}`);
  const slug = String(chatSeq).padStart(3, '0');
  const link = platform === 'telegram' ? `https://t.me/demo_chat_${slug}`
    : platform === 'whatsapp' ? `https://chat.whatsapp.com/DEMO${slug}${'ABCDEFGHJKLMNPQRSTUVWXYZ'.slice(chatSeq % 20, chatSeq % 20 + 8)}`
    : platform === 'viber' ? `https://invite.viber.com/?g2=DEMO${slug}Qm${chatSeq * 7919 % 100000}`
    : `https://www.facebook.com/groups/demo.group.${slug}`;
  const chat = { id: `demo-chat-${slug}`, platform, name: platform === 'viber' ? `${name} в Viber` : name, link, status, ...extra };
  chats.push(chat);
  return chat;
}

// Telegram: 225 чатів. До приєднання: 24 у черзі акаунтів, 36 нових; готові 120; в архіві 45.
for (let i = 0; i < 36; i += 1) makeChat('telegram', 'to_join', { created: -between(0, 6) });
for (let i = 0; i < 24; i += 1) { const acc = ACCOUNTS[i < 12 ? 0 : i < 19 ? 1 : 2]; makeChat('telegram', 'to_join', { account: acc.id, candidate: -between(0, 3), created: -between(1, 8) }); }
for (let i = 0; i < 120; i += 1) makeChat('telegram', 'ready', { account: ACCOUNTS[i % 7 < 4 ? 0 : i % 7 < 6 ? 1 : 2].id, joined: -between(3, 88) });
for (let i = 0; i < 45; i += 1) makeChat('telegram', 'archived', { account: ACCOUNTS[i % 2].id, joined: -between(20, 85), archivedDay: -between(1, 40), reason: pick(['Пишуть лише адміни', 'Забанено', 'Чат не існує', 'Вийшов']) });
// WhatsApp: 64.
for (let i = 0; i < 10; i += 1) makeChat('whatsapp', 'to_join', { created: -between(0, 5) });
for (let i = 0; i < 10; i += 1) makeChat('whatsapp', 'waiting', { joined: -between(0, 5) });
for (let i = 0; i < 38; i += 1) makeChat('whatsapp', 'ready', { joined: -between(3, 80) });
for (let i = 0; i < 6; i += 1) makeChat('whatsapp', 'archived', { joined: -between(20, 80), archivedDay: -between(1, 30), reason: pick(['Пишуть лише адміни', 'Забанено']) });
// Viber: 33.
for (let i = 0; i < 6; i += 1) makeChat('viber', 'to_join', { created: -between(0, 5) });
for (let i = 0; i < 22; i += 1) makeChat('viber', 'ready', { joined: -between(3, 70) });
for (let i = 0; i < 5; i += 1) makeChat('viber', 'archived', { joined: -between(20, 70), archivedDay: -between(1, 30), reason: pick(['Забанено', 'Чат не існує']) });
// Facebook: 11.
for (let i = 0; i < 2; i += 1) makeChat('facebook', 'to_join', { created: -between(0, 4) });
for (let i = 0; i < 8; i += 1) makeChat('facebook', 'ready', { joined: -between(3, 60) });
makeChat('facebook', 'archived', { joined: -30, archivedDay: -10, reason: 'Вийшов' });

for (const chat of chats) {
  const created = chat.joined !== undefined ? chat.joined - between(0, 2) : (chat.created ?? -5);
  chat.row = {
    id: chat.id, user_id: U, platform: chat.platform, name: chat.name, link: chat.link, normalized_link: chat.link.toLowerCase(), workflow_status: chat.status, is_private: 0,
    joined_at: chat.joined !== undefined ? ts(chat.joined, 40000) : null, processed_at: null,
    snoozed_until: chat.status === 'ready' && chance(0.07) ? ts(between(1, 3)) : null,
    archive_reason: chat.status === 'archived' ? chat.reason : null, archived_at: chat.status === 'archived' ? ts(chat.archivedDay, 50000) : null,
    created_at: ts(created, 36000), updated_at: ts(chat.joined ?? chat.created ?? -3, 40000 + chat.id.length), note: '', telegram_account_id: chat.account ?? null,
    join_candidate_at: chat.candidate !== undefined ? ts(chat.candidate, 30000 + chatSeq) : null,
  };
}
const CHAT_COLUMNS = ['id', 'user_id', 'platform', 'name', 'link', 'normalized_link', 'workflow_status', 'is_private', 'joined_at', 'processed_at', 'snoozed_until', 'archive_reason', 'archived_at', 'created_at', 'updated_at', 'note', 'telegram_account_id', 'join_candidate_at'];
insert('chats', CHAT_COLUMNS, chats.map((chat) => chat.row));

// Профілі: готові й очікувальні чати. Більшість підтверджені (інакше «Для публікації» порожнє).
const readyChats = chats.filter((chat) => chat.status === 'ready');
const profileRows = [];
for (const chat of chats.filter((c) => c.status === 'ready' || c.status === 'waiting')) {
  const confirmed = chance(0.82);
  const weekly = chat.status === 'ready' && chance(0.12);
  profileRows.push({
    chat_id: chat.id, language: weighted([['uk', 80], ['ru', 12], [null, 8]]), cadence: weekly ? 'weekly' : chance(0.15) ? 'several_week' : 'any',
    weekdays_json: '[]', directions_json: JSON.stringify(chance(0.7) ? [pick(SUBJECTS.map(([s]) => s).slice(0, 5))] : []), note: '',
    review_status: confirmed ? 'confirmed' : 'draft', source: 'manual', updated_at: ts(-between(1, 30)), custom_interval_days: null, next_allowed_on: null, weekly,
  });
}
insert('chat_profiles', ['chat_id', 'language', 'cadence', 'weekdays_json', 'directions_json', 'note', 'review_status', 'source', 'updated_at', 'custom_interval_days', 'next_allowed_on'], profileRows);
const profileByChat = new Map(profileRows.map((row) => [row.chat_id, row]));

// ---------------------------------------------------------------- оголошення та бібліотека

const ADS = [
  ['Безкоштовне пробне заняття з англійської', 'Англійська', 'Запрошуємо на безкоштовне пробне заняття з англійської мови для дітей 7–14 років. Живе спілкування, ігри та зрозуміла граматика. Напишіть в особисті, підберемо викладача й час.'],
  ['Математика без стресу: 1–11 клас', 'Математика', 'Допоможемо підтягнути математику за шкільною програмою, закрити прогалини й підготуватись до тестів. Перше заняття безкоштовне. Пишіть в особисті.'],
  ['Німецька для дітей і дорослих', 'Німецька', 'Німецька з нуля та для тих, хто вже вчить: розмовна практика, підготовка до іспитів, зручний графік. Пробне заняття безкоштовне.'],
  ['Українська школа онлайн: комплексна підтримка', 'Шкільні предмети — комплексно', 'Допомога зі шкільними предметами для дітей за кордоном: домашні завдання, підготовка до контрольних, зв’язок із українською програмою.'],
  ['Малювання для дітей онлайн', 'Малювання', 'Малюємо разом із викладачем: від перших ліній до власних історій. Заняття у малих групах, матеріали прості й доступні.'],
  ['ІТ та шахи для школярів', 'ІТ та шахи', 'Знайомимо дітей з логікою програмування й шахами в ігровій формі. Перше заняття безкоштовне, запис в особисті.'],
  ['Польська мова для переїзду і школи', 'Польська', 'Допоможемо швидко заговорити польською: школа, робота, щоденні ситуації. Індивідуальні заняття та міні-групи.'],
  ['Логопед онлайн для дітей', 'Логопедія та дефектологія', 'Корекція мовлення, розвиток уваги й пам’яті в дистанційному форматі. Перша консультація безкоштовна.'],
];
const libraryItems = [];
const libraryVersions = [];
function addLibrary(item) {
  libraryItems.push({ id: item.id, user_id: U, kind: item.kind, title: item.title, uk_text: item.uk, ru_text: item.ru ?? '', notes: item.notes ?? '', tags_json: JSON.stringify(item.tags ?? []),
    platforms_json: JSON.stringify(item.platforms ?? []), archived_at: item.archived ? ts(-3) : null, created_at: ts(item.day ?? -40), updated_at: ts(item.day ?? -40), version: 1,
    collection: item.collection, stage: item.stage ?? null, branch: item.branch ?? '', origin_id: item.origin ?? null, template_key: item.templateKey ?? null });
  libraryVersions.push({ id: `${item.id}-v1`, user_id: U, item_id: item.id, version_number: 1, action: 'create', kind: item.kind, collection: item.collection, title: item.title, uk_text: item.uk, ru_text: item.ru ?? '',
    notes: item.notes ?? '', tags_json: JSON.stringify(item.tags ?? []), platforms_json: JSON.stringify(item.platforms ?? []), archived_at: null, saved_at: ts(item.day ?? -40) });
}
ADS.forEach(([title, direction, text], index) => addLibrary({ id: `demo-ad-${index + 1}`, kind: 'advertisement', collection: 'advertisement', title, uk: text, ru: text.replace('Запрошуємо', 'Приглашаем'),
  tags: [direction], platforms: index % 3 === 2 ? ['telegram', 'whatsapp'] : ['telegram', 'whatsapp', 'viber', 'facebook'], day: -60 + index * 3 }));
const TEMPLATE_STAGE = { lesson_booked: 'booked', reminder_day: 'reminder', reminder_hour: 'reminder' };
for (const template of TEMPLATE_SCRIPTS) {
  addLibrary({ id: `demo-tpl-${template.key}`, kind: 'script', collection: 'official_script', title: template.title, uk: template.ukText, ru: template.ruText, tags: [], stage: template.stage ?? TEMPLATE_STAGE[template.key] ?? null, templateKey: template.key, day: -50 });
}
const SCRIPTS = [
  ['Привітання після відгуку', 'response', '', ['Англійська'], 'Добрий день, [звертання]! Дякуємо за відгук. Підкажіть, будь ласка, скільки років [учень] і який рівень зараз? Тоді підберемо викладача для безкоштовного пробного заняття.'],
  ['Уточнення мети навчання', 'clarification', '', [], '[звертання], щоб заняття були корисними, підкажіть: чого хочете досягти за 2–3 місяці? Це допоможе вибрати програму для [предмет].'],
  ['Заперечення: дорого', 'clarification', 'Ціна', [], 'Розумію вас, [звертання]. Пробне заняття безкоштовне, тож ви побачите формат без жодних зобов’язань. Далі підберемо пакет під ваш бюджет, є кілька варіантів.'],
  ['Заперечення: немає часу', 'clarification', 'Час', [], '[звертання], заняття можна поставити на вечір або на вихідні. Скажіть, коли зручно, і я запропоную найближчі вільні слоти викладача.'],
  ['Запис на пробне заняття', 'booked', '', [], 'Записали [учень] на [предмет]: [дата уроку] о [час уроку], викладач — [вчитель]. Посилання на заняття: [посилання на заняття].'],
  ['Повторний дотик через день', 'clarification', 'Повторний дотик', [], 'Добрий день, [звертання]! Нагадую про безкоштовне пробне заняття з [предмет]. Підкажіть, чи актуально, і я запропоную час.'],
  ['Після уроку: збір відгуку', 'result', '', [], '[звертання], дякуємо, що були на занятті! Як вам перше враження від [предмет]? Можу запропонувати пакет та розклад.'],
  ['Німецька: привітання', 'response', '', ['Німецька'], 'Добрий день, [звертання]! Німецька для [учень] — гарний вибір. Який рівень зараз і яка мета: школа, переїзд чи іспит?'],
  ['Математика: уточнення', 'clarification', '', ['Математика'], '[звертання], підкажіть клас [учень] і які теми даються найважче. Підберемо викладача саме під ці прогалини.'],
];
SCRIPTS.forEach(([title, stage, branch, tags, text], index) => addLibrary({ id: `demo-script-${index + 1}`, kind: 'script', collection: 'official_script', title, uk: text, tags: [...tags, 'Дитина'], stage, branch, day: -45 + index }));
addLibrary({ id: 'demo-personal-1', kind: 'script', collection: 'personal_script', title: 'Мій коротке привітання', uk: 'Добрий день, [звертання]! Дякую, що написали. Розкажіть, що вас цікавить, і я допоможу.', origin: 'demo-script-1', stage: 'response', day: -20 });
addLibrary({ id: 'demo-personal-2', kind: 'script', collection: 'personal_script', title: 'Нагадування у вайбері', uk: '[звертання], нагадую: завтра пробне заняття з [предмет] о [час уроку]. Будь ласка, підтвердіть участь.', stage: 'reminder', day: -12 });
const KNOWLEDGE = [
  ['Формат пробного заняття', 'Тривалість 30–40 хвилин. Викладач знайомиться з учнем, перевіряє рівень, пропонує план. Запис відеозаняття не ведеться.'],
  ['Як відповідати на «чи є знижки»', 'Пакети мають різну вартість залежно від кількості занять. Спершу з’ясуйте регулярність, потім називайте варіанти й порівнюйте ціну одного заняття.'],
  ['Правила публікацій у чатах', 'Не більше одного оголошення на день в одному чаті, не публікувати в чатах з забороною реклами, при зауваженні адмінів одразу видаляти повідомлення й архівувати чат.'],
];
KNOWLEDGE.forEach(([title, text], index) => addLibrary({ id: `demo-kb-${index + 1}`, kind: 'script', collection: 'knowledge', title, uk: text, day: -35 + index }));

const LIB_COLUMNS = ['id', 'user_id', 'kind', 'title', 'uk_text', 'ru_text', 'notes', 'tags_json', 'platforms_json', 'archived_at', 'created_at', 'updated_at', 'version', 'collection', 'stage', 'branch', 'origin_id', 'template_key'];
insert('library_items', LIB_COLUMNS, libraryItems);
insert('library_item_versions', ['id', 'user_id', 'item_id', 'version_number', 'action', 'kind', 'collection', 'title', 'uk_text', 'ru_text', 'notes', 'tags_json', 'platforms_json', 'archived_at', 'saved_at'], libraryVersions);

// ---------------------------------------------------------------- розвиток (dev_items)

const DEV = [
  ['improvement', 'Швидкий пошук по лідах за телефоном', 'Шукати лід за кількома останніми цифрами номера.', 'idea', 'normal', [['Прототип пошуку', 1], ['Перевірити на великій базі', 0]]],
  ['bug', 'Тижневий графік плутає понеділок і неділю', 'У деяких локалях тиждень починається з неділі.', 'doing', 'high', [['Відтворити помилку', 1], ['Виправити порядок днів', 0]]],
  ['idea', 'Сповіщення про лід без відповіді понад годину', '', 'idea', 'low', []],
  ['improvement', 'Нагадування про звіт за 15 хвилин до проміжного', 'Не забувати про проміжні звіти 13:00, 16:00, 19:00.', 'done', 'normal', [['Додати до шкали дня', 1], ['Перевірити на телефоні', 1]]],
  ['improvement', 'Експорт аналітики по тижнях', 'Щотижневий CSV з розбивкою за платформами.', 'postponed', 'low', [['Узгодити формат', 0]]],
  ['bug', 'Дублікат чату після імпорту з CSV', 'Якщо посилання різняться лише параметром, чат дублюється.', 'doing', 'normal', [['Знайти приклад', 1], ['Нормалізувати посилання', 0], ['Перевірити імпорт', 0]]],
];
insert('dev_items', ['id', 'user_id', 'type', 'title', 'body', 'status', 'priority', 'checklist_json', 'photos_json', 'notes', 'position', 'version', 'archived_at', 'created_at', 'updated_at'],
  DEV.map(([type, title, body, status, priority, checks], index) => ({ id: `demo-dev-${index + 1}`, user_id: U, type, title, body, status, priority,
    checklist_json: JSON.stringify(checks.map(([text, done], i) => ({ id: `c${i + 1}`, text, done: Boolean(done) }))), photos_json: '[]', notes: '', position: (index + 1) * 1000, version: 1, archived_at: null, created_at: ts(-20 + index), updated_at: ts(-10 + index) })));

// ---------------------------------------------------------------- події: публікації, нові чати

const events = [];
const publications = [];
let eventSeq = 0;
function addEvent(type, { platform = null, chatId = null, leadId = null, lessonId = null, day, sec, meta = {}, account = null, cancelled = false, key }) {
  eventSeq += 1;
  events.push({ id: `demo-ev-${String(eventSeq).padStart(5, '0')}`, user_id: U, event_type: type, platform, chat_id: chatId, lead_id: leadId, lesson_id: lessonId, occurred_at: ts(day, sec), event_date: dt(day),
    metadata_json: JSON.stringify(meta), source_key: key ?? `demo:${type}:${eventSeq}`, telegram_account_id: account, cancelled_at: cancelled ? ts(day, sec + 3600) : null });
}
const dayCounts = new Map(); // «день|платформа|тип» → кількість (для звітів)
const bump = (day, platform, type) => { const key = `${day}|${platform}|${type}`; dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1); };
const lastPublished = new Map();

// Історія стану чатів (приєднання) для готових та очікувальних
for (const chat of chats) {
  if (chat.status === 'ready' || chat.status === 'waiting' || chat.status === 'archived') {
    addEvent('chat_state_changed', { platform: chat.platform, chatId: chat.id, day: chat.joined, sec: 38000, meta: { action: 'joined' }, account: chat.account ?? null });
  }
}
// Публікації: 90 днів (давніші рідше, щоб скидання лишалось дешевим), будні щільніше. Чат не частіше за раз на добу й за своїм профілем.
const publishable = readyChats.filter((chat) => profileByChat.get(chat.id)?.review_status === 'confirmed');
for (let day = -90; day <= -1; day += 1) {
  const base = day < -45 ? between(1, 3) : between(3, 8);
  const used = new Set();
  for (let k = 0; k < base; k += 1) {
    const eligible = publishable.filter((chat) => chat.joined <= day - 1 && !used.has(chat.id) && (lastPublished.get(chat.id) ?? -999) < day - (profileByChat.get(chat.id).weekly ? 7 : 1));
    if (!eligible.length) break;
    const chat = pick(eligible);
    used.add(chat.id);
    lastPublished.set(chat.id, day);
    const id = `demo-pub-${String(publications.length + 1).padStart(4, '0')}`;
    const sec = 32400 + k * 2400 + between(0, 900);
    publications.push({ id, user_id: U, chat_id: chat.id, published_on: dt(day), published_at: ts(day, sec), advertisement_id: `demo-ad-${between(1, ADS.length)}`, source: 'manual', source_key: `manual:${id}`, created_at: ts(day, sec), telegram_account_id: chat.account ?? null, platform: chat.platform });
    addEvent('publication', { platform: chat.platform, chatId: chat.id, day, sec, meta: { publicationId: id }, account: chat.account ?? null, key: `publication:${id}` });
    bump(day, chat.platform, 'publication');
  }
}
// Профілі «раз на тиждень»: наступна дозволена дата після останньої публікації
for (const chat of publishable) {
  const profile = profileByChat.get(chat.id);
  const last = lastPublished.get(chat.id);
  if (profile.weekly && last !== undefined && last > -7) profile.next_allowed_on = dt(last + 7);
}
// Нові чати: приєднання за 90 днів
for (let day = -90; day <= -1; day += 1) {
  const count = day < -45 ? (chance(0.5) ? 1 : 0) : between(0, 3);
  for (let k = 0; k < count; k += 1) {
    const chat = pick(readyChats);
    addEvent('chat_joined', { platform: chat.platform, chatId: chat.id, day, sec: 41000 + k * 1700, account: chat.account ?? null });
    bump(day, chat.platform, 'chat_joined');
  }
}
// Сьогодні: кілька приєднань уже «з ночі» не додаємо, день чистий.

// Профілі вже вставлені без next_allowed_on; доповнюємо оновленням лише там, де воно є.
for (const profile of profileRows) {
  if (profile.next_allowed_on) sql(`UPDATE chat_profiles SET next_allowed_on=${lit(profile.next_allowed_on)} WHERE chat_id=${lit(profile.chat_id)}`);
}

// ---------------------------------------------------------------- ліди, учні, уроки

const STAGE_PLAN = [['response', 7], ['clarification', 8], ['booked', 7], ['reminder', 5], ['lesson', 5], ['result', 18]];
const leads = [];
const students = [];
const lessons = [];
const reminders = [];
const messages = [];
const curator = [];
let phoneSeq = 0;
function lessonStatusFor(stage, index) {
  if (stage === 'result') return index % 5 === 4 ? 'no-show' : index % 7 === 6 ? 'cancelled' : 'completed';
  return 'booked';
}
for (const [stage, count] of STAGE_PLAN) {
  for (let i = 0; i < count; i += 1) {
    phoneSeq += 1;
    const female = chance(0.72);
    const adult = chance(0.35);
    const name = fullName(female);
    const platform = weighted(PLATFORM_MIX);
    const sourceChat = pick(chats.filter((chat) => chat.platform === platform && chat.status !== 'to_join'));
    const subject = weighted(SUBJECTS);
    const resultLessonDay = chance(0.75) ? -between(1, 24) : -between(25, 60);
    const responseDay = stage === 'result' ? resultLessonDay - between(3, 7) : stage === 'response' ? -between(0, 2) : stage === 'clarification' ? -between(0, 5) : stage === 'booked' ? -between(1, 8) : stage === 'reminder' ? -between(2, 6) : -between(3, 9);
    const responseSec = between(32000, 70000);
    const lead = { id: `demo-lead-${String(phoneSeq).padStart(3, '0')}`, stage, name, female, adult, platform, sourceChat, subject, responseDay, responseSec, resultLessonDay, phone: `+3805055501${String(phoneSeq).padStart(2, '0')}`,
      telegram: `demo_user_${phoneSeq}` };
    leads.push(lead);
    const hasLesson = ['booked', 'reminder', 'lesson', 'result'].includes(stage);
    if (!adult) {
      const kid = { id: `demo-student-${phoneSeq}`, lead, name: pick(female ? KIDS_F : KIDS_M), grade: between(1, 9) };
      students.push(kid);
      lead.student = kid;
    }
    if (hasLesson) {
      const lessonDay = stage === 'booked' ? between(2, 6) : stage === 'reminder' ? 1 : stage === 'lesson' ? 0 : resultLessonDay;
      const hour = stage === 'lesson' ? [9, 11, 16, 17, 18, 19][i % 6] : between(10, 19);
      const time = `${String(hour).padStart(2, '0')}:${chance(0.5) ? '00' : '30'}`;
      const bookingDay = stage === 'result' ? Math.min(lessonDay - between(1, 4), responseDay + 1) : Math.max(responseDay, -between(1, 3));
      lead.lesson = { id: `demo-lesson-${String(phoneSeq).padStart(3, '0')}`, lessonDay, time, hour, minute: time.endsWith('30') ? 30 : 0, bookingDay: Math.min(bookingDay, lessonDay), status: lessonStatusFor(stage, i), teacher: pick(TEACHERS) };
    }
    if (stage === 'clarification' && i >= 9) curator.push(lead);
  }
}

const FUNNEL_BY_STAGE = { response: 'response', clarification: 'clarification', booked: 'booked', reminder: 'reminder', lesson: 'lesson', result: 'result' };
const leadRows = [];
for (const lead of leads) {
  const resolved = lead.stage === 'result' && lead.lesson.status === 'completed';
  const nextContact = lead.stage === 'response' ? (lead.responseDay === 0 ? ts(0, 43200) : ts(-1, 54000)) : lead.stage === 'clarification' ? (chance(0.5) ? ts(-1, 50000) : ts(1, 36000)) : null;
  const customReminder = lead.id === 'demo-lead-004' || lead.id === 'demo-lead-013' || lead.id === 'demo-lead-021';
  leadRows.push({
    id: lead.id, user_id: U, name: lead.name, phone: lead.phone, telegram_username: lead.telegram, normalized_phone: lead.phone.replace('+', ''), normalized_telegram: lead.telegram,
    platform: lead.platform, source_chat_id: lead.sourceChat.id, source_chat_link: lead.sourceChat.link, note: '', needs_details: lead.stage === 'response' && chance(0.4) ? 1 : 0,
    status: lead.stage === 'result' ? (resolved ? 'won' : 'lost') : lead.stage === 'response' ? 'new' : 'active', teacher_name: lead.lesson?.teacher ?? '', lesson_platform: lead.lesson ? pick(['Zoom', 'Google Meet']) : null,
    meeting_link: lead.lesson ? `https://meet.example.test/demo-${lead.id.slice(-3)}` : '', is_student: lead.adult ? 1 : 0, age_group: lead.adult ? 'adult' : 'child',
    created_at: ts(lead.responseDay, lead.responseSec), booked_at: lead.lesson ? ts(lead.lesson.bookingDay, 45000) : null, archived_at: null, updated_at: ts(Math.min(0, lead.lesson?.lessonDay ?? lead.responseDay), 50000),
    response_date: dt(lead.responseDay), booking_date: lead.lesson ? dt(lead.lesson.bookingDay) : null, response_cancelled_at: null, response_cancelled_date: null, subject: lead.subject,
    response_at: ts(lead.responseDay, lead.responseSec), first_reply_at: lead.stage === 'response' && chance(0.5) ? null : ts(lead.responseDay, lead.responseSec + between(300, 5400)),
    qualification: lead.stage === 'result' ? pick(['A', 'B']) : chance(0.5) ? pick(['A', 'B', 'C']) : null, funnel_stage: FUNNEL_BY_STAGE[lead.stage],
    next_action: nextContact ? pick(['Уточнити зручний час', 'Запропонувати пробне заняття', 'Передзвонити']) : '', next_contact_at: nextContact, managed_at: null, version: 1, contact_unknown: 0,
    custom_reminders_json: customReminder ? JSON.stringify([{ id: `${lead.id}-r1`, text: 'Надіслати розклад на тиждень', at: lead.id === 'demo-lead-004' ? Math.floor(0) : 0, doneAt: null }]) : null,
    next_custom_reminder_at: null, interest: lead.subject === 'Англійська' ? 'Розмовна' : lead.subject === 'Математика' ? 'Прогалини' : '',
  });
}
const LEAD_COLUMNS = Object.keys(leadRows[0]);
// Власні нагадування мають час у секундах від @T: підставляємо після побудови рядків.
for (const row of leadRows) {
  if (row.custom_reminders_json) {
    const idx = leads.findIndex((lead) => lead.id === row.id);
    const at = idx % 2 === 0 ? ts(-1, 61000) : ts(0, 54000);
    row.next_custom_reminder_at = at;
    row.custom_reminders_json = raw(`json_array(json_object('id',${lit(`${row.id}-r1`)},'text','Надіслати розклад на тиждень','at',${at.sql},'doneAt',NULL))`);
  }
}
insert('leads', LEAD_COLUMNS, leadRows, { chunk: 25 });
insert('students', ['id', 'user_id', 'lead_id', 'legacy_id', 'name', 'surname', 'age_group', 'note', 'created_at', 'updated_at', 'grade', 'kind'],
  students.map((kid) => ({ id: kid.id, user_id: U, lead_id: kid.lead.id, legacy_id: null, name: kid.name, surname: kid.lead.name.split(' ')[1] ?? '', age_group: '', note: '', created_at: ts(kid.lead.responseDay, kid.lead.responseSec), updated_at: ts(kid.lead.responseDay, kid.lead.responseSec), grade: kid.grade, kind: 'child' })));
// Дорослий лід навчається сам: учень kind='self' (як після міграції 0058), предмет відгуку лежить у предметах учня.
const selfStudents = leads.filter((lead) => !lead.student).map((lead) => ({ id: `demo-self-${lead.id}`, lead }));
insert('students', ['id', 'user_id', 'lead_id', 'legacy_id', 'name', 'surname', 'age_group', 'note', 'created_at', 'updated_at', 'grade', 'kind'],
  selfStudents.map(({ id, lead }) => ({ id, user_id: U, lead_id: lead.id, legacy_id: null, name: lead.name, surname: '', age_group: '', note: '', created_at: ts(lead.responseDay, lead.responseSec), updated_at: ts(lead.responseDay, lead.responseSec), grade: null, kind: 'self' })));
insert('student_subjects', ['id', 'user_id', 'lead_id', 'student_id', 'subject', 'created_at'],
  [...students.map((kid) => ({ studentId: kid.id, lead: kid.lead })), ...selfStudents.map(({ id, lead }) => ({ studentId: id, lead }))]
    .map(({ studentId, lead }) => ({ id: `ss-${studentId}`, user_id: U, lead_id: lead.id, student_id: studentId, subject: lead.subject, created_at: ts(lead.responseDay, lead.responseSec) })));

const lessonRows = [];
for (const lead of leads) {
  if (!lead.lesson) continue;
  const l = lead.lesson;
  lessonRows.push({ id: l.id, user_id: U, lead_id: lead.id, student_id: lead.student?.id ?? null, legacy_id: null, student_name: lead.student ? `${lead.student.name} ${lead.name.split(' ')[1] ?? ''}`.trim() : lead.name, subject: lead.subject,
    teacher_name: l.teacher, lesson_date: dt(l.lessonDay), lesson_time: l.time, lesson_platform: lead.lesson ? pick(['Zoom', 'Google Meet']) : null, meeting_link: `https://meet.example.test/demo-${lead.id.slice(-3)}`, status: l.status,
    created_at: ts(l.bookingDay, 45000), updated_at: ts(Math.min(0, l.lessonDay), 50000), booking_date: dt(l.bookingDay), status_reason: l.status === 'cancelled' ? 'Не підійшов час' : l.status === 'no-show' ? 'Не зʼявився на заняття' : '', rescheduled_from_id: null });
  if (l.status === 'booked') {
    for (const [slot, offset] of [[1, 1440], [2, 60]]) {
      // Секунди від сьогоднішньої півночі: що вже минуло на момент сиду, наполовину позначено надісланим, решта — прострочені нагадування.
      const due = l.lessonDay * DAY + l.hour * 3600 + l.minute * 60 - offset * 60;
      reminders.push({ id: `${l.id}:reminder:${slot}`, user_id: U, lesson_id: l.id, slot, enabled: 1, offset_minutes: offset, sent_at: due < 0 && chance(0.55) ? ts(0, due) : null, skipped_at: null, updated_at: ts(l.bookingDay, 45000) });
    }
  }
}
const LESSON_COLUMNS = Object.keys(lessonRows[0]);
insert('lessons', LESSON_COLUMNS, lessonRows, { chunk: 30 });
insert('lesson_reminders', ['id', 'user_id', 'lesson_id', 'slot', 'enabled', 'offset_minutes', 'sent_at', 'skipped_at', 'updated_at'], reminders);

// Події лідів, записів, проведених уроків
for (const lead of leads) {
  addEvent('lead_created', { platform: lead.platform, chatId: lead.sourceChat.id, leadId: lead.id, day: lead.responseDay, sec: lead.responseSec, meta: { responseDate: null }, key: `leads:${lead.id}:lead_created` });
  bump(lead.responseDay, lead.platform, 'lead_created');
  if (lead.lesson) {
    const l = lead.lesson;
    addEvent('lesson_booked', { platform: lead.platform, chatId: lead.sourceChat.id, leadId: lead.id, lessonId: l.id, day: l.bookingDay, sec: 45000, meta: { bookingDate: null, lessonDate: null }, cancelled: l.status === 'cancelled', key: `leads:${lead.id}:lesson_booked` });
    if (l.status !== 'cancelled') bump(l.bookingDay, lead.platform, 'lesson_booked');
    if (l.status === 'completed') addEvent('lesson_completed', { platform: lead.platform, chatId: lead.sourceChat.id, leadId: lead.id, lessonId: l.id, day: l.lessonDay, sec: 72000, meta: { reason: '' }, key: `leads:${lead.id}:lesson_completed` });
    if (l.status === 'no-show') addEvent('lesson_no_show', { platform: lead.platform, leadId: lead.id, lessonId: l.id, day: l.lessonDay, sec: 72000, meta: { reason: 'Не зʼявився на заняття' }, key: `leads:${lead.id}:lesson_no_show` });
    if (l.status === 'cancelled') addEvent('lesson_cancelled', { platform: lead.platform, leadId: lead.id, lessonId: l.id, day: l.lessonDay - 1, sec: 50000, meta: { reason: 'Не підійшов час' }, key: `leads:${lead.id}:lesson_cancelled` });
  }
}
// Давня історія без карток лідів: лише події для аналітики (відгуки, записи, проведені уроки). Картки лідів тримаємо за останні тижні,
// щоб нічне скидання лишалось дешевим, а порівняння з попереднім періодом мало реалістичні цифри.
const historyChats = chats.filter((chat) => chat.status !== 'to_join');
const historyChat = () => { const platform = weighted(PLATFORM_MIX); return pick(historyChats.filter((chat) => chat.platform === platform) || historyChats); };
for (let day = -90; day <= -29; day += 1) {
  for (let k = between(0, 3); k > 0; k -= 1) { const chat = historyChat(); addEvent('lead_created', { platform: chat.platform, chatId: chat.id, day, sec: between(32000, 70000), meta: {} }); }
  if (chance(0.45)) { const chat = historyChat(); addEvent('lesson_booked', { platform: chat.platform, chatId: chat.id, day, sec: 45000, meta: {} }); }
  if (chance(0.3)) { const chat = historyChat(); addEvent('lesson_completed', { platform: chat.platform, chatId: chat.id, day, sec: 72000, meta: {} }); }
}
// Запити куратору (два у стані очікування)
const curatorLeads = curator.slice(0, 2);
insert('curator_requests', ['id', 'user_id', 'lead_id', 'legacy_id', 'status', 'submitted_at', 'submitted_date', 'resolved_at', 'lesson_id', 'created_at', 'updated_at', 'source_import_id'],
  curatorLeads.map((lead, i) => ({ id: `demo-curator-${i + 1}`, user_id: U, lead_id: lead.id, legacy_id: null, status: 'pending', submitted_at: ts(-1, 50000), submitted_date: dt(-1), resolved_at: null, lesson_id: null, created_at: ts(-1, 50000), updated_at: ts(-1, 50000), source_import_id: null })));
curatorLeads.forEach((lead, i) => addEvent('curator_booking_pending', { platform: lead.platform, leadId: lead.id, day: -1, sec: 50000, meta: { curatorRequestId: `demo-curator-${i + 1}`, status: 'pending' }, key: `leads:${lead.id}:curator_booking_pending` }));

// Розмови з частиною лідів
const MESSAGE_SCRIPTS = [
  [['lead', 'Добрий день! Бачила ваше оголошення, цікавить заняття для дитини.'], ['me', 'Добрий день! Дякую за відгук. Скільки років дитині й який предмет цікавить?'], ['lead', 'Їй 9, потрібна допомога з математикою.']],
  [['lead', 'Доброго дня, скільки коштує заняття?'], ['me', 'Перше пробне заняття безкоштовне, далі є кілька пакетів. Підкажіть, як часто плануєте займатися?']],
  [['lead', 'Здрастуйте, чи є вільні місця на англійську ввечері?'], ['me', 'Так, є. Можу запропонувати четвер і п’ятницю після 18:00.'], ['lead', 'Четвер підійде.']],
];
leads.slice(0, 18).forEach((lead, index) => {
  MESSAGE_SCRIPTS[index % MESSAGE_SCRIPTS.length].forEach(([sender, body], k) => {
    const at = ts(lead.responseDay, lead.responseSec + k * 900);
    messages.push({ id: `demo-msg-${lead.id.slice(-3)}-${k + 1}`, user_id: U, lead_id: lead.id, sender, body, sent_at: at, created_at: at, updated_at: at, deleted_at: null });
  });
});
insert('lead_messages', ['id', 'user_id', 'lead_id', 'sender', 'body', 'sent_at', 'created_at', 'updated_at', 'deleted_at'], messages);

// ---------------------------------------------------------------- розклад Telegram на сьогодні

const scheduleChats = chats.filter((chat) => chat.platform === 'telegram' && chat.status === 'ready' && chat.account === 'demo-acc-1' && profileByChat.get(chat.id)?.review_status === 'confirmed').slice(0, 26);
insert('telegram_schedule_settings', ['user_id', 'telegram_account_id', 'interval_minutes', 'base_at', 'selection_mode', 'manual_chat_ids_json', 'updated_at', 'version'],
  [{ user_id: U, telegram_account_id: 'demo-acc-1', interval_minutes: 25, base_at: ts(0, 30600), selection_mode: 'auto', manual_chat_ids_json: '[]', updated_at: ts(-1, 70000), version: 1 }]);
insert('telegram_schedule_slots', ['id', 'user_id', 'telegram_account_id', 'sequence', 'scheduled_at', 'chat_id', 'status', 'completed_at', 'publication_id', 'created_at', 'updated_at', 'version'],
  scheduleChats.map((chat, index) => ({ id: `demo-slot-${String(index + 1).padStart(2, '0')}`, user_id: U, telegram_account_id: 'demo-acc-1', sequence: index + 1, scheduled_at: ts(0, 30600 + index * 1500), chat_id: chat.id, status: 'pending',
    completed_at: null, publication_id: null, created_at: ts(-1, 70000), updated_at: ts(-1, 70000), version: 0 })));

// ---------------------------------------------------------------- записи подій, публікацій

const EVENT_COLUMNS = ['id', 'user_id', 'event_type', 'platform', 'chat_id', 'lead_id', 'lesson_id', 'occurred_at', 'event_date', 'metadata_json', 'source_key', 'telegram_account_id', 'cancelled_at'];
const PUB_COLUMNS = ['id', 'user_id', 'chat_id', 'published_on', 'published_at', 'advertisement_id', 'source', 'source_key', 'created_at', 'telegram_account_id', 'platform'];
insert('chat_publications', PUB_COLUMNS, publications);
insert('activity_events', EVENT_COLUMNS, events, { chunk: 40 });

// ---------------------------------------------------------------- робочі дні, звіти

const workdays = [];
for (let day = -14; day <= -1; day += 1) {
  if (day % 7 === 0) continue;
  workdays.push({ id: `demo-wd-${-day}`, user_id: U, work_date: dt(day), status: 'ended', started_at: ts(day, 32400 + between(-600, 900)), active_since: null, paused_at: null, ended_at: ts(day, 64800 + between(-1200, 3000)),
    active_seconds: 27000 + between(-3000, 2400), created_at: ts(day, 32400), updated_at: ts(day, 64800), version: 1 });
}
insert('workdays', ['id', 'user_id', 'work_date', 'status', 'started_at', 'active_since', 'paused_at', 'ended_at', 'active_seconds', 'created_at', 'updated_at', 'version'], workdays);
// Журнал пауз: у кожного завершеного дня обідня пауза.
insert('workday_pauses', ['id', 'workday_id', 'user_id', 'started_at', 'ended_at'],
  workdays.map((day) => { const offset = -Number(day.id.replace('demo-wd-', '')); return { id: `demo-wp-${-offset}`, workday_id: day.id, user_id: U, started_at: ts(offset, 46800), ended_at: ts(offset, 49200) }; }));

const PLATFORM_ORDER = ['telegram', 'threads', 'whatsapp', 'facebook', 'viber'];
const PLATFORM_LABELS = { telegram: 'Telegram', threads: 'Threads', whatsapp: 'WhatsApp', facebook: 'Facebook', viber: 'Viber' };
const count = (day, platform, type) => dayCounts.get(`${day}|${platform}|${type}`) ?? 0;
const reportRows = [];
/** Текст звіту як вираз SQL: дата в заголовку рахується від «сьогодні», бо сид однаковий щодня, а календар зсувається. */
function reportText(day, extra = '') {
  const lines = [''];
  PLATFORM_ORDER.forEach((platform, index) => {
    lines.push(PLATFORM_LABELS[platform], `Оголошення: ${count(day, platform, 'publication')}`);
    if (platform !== 'threads') lines.push(`Нові чати: ${count(day, platform, 'chat_joined')}`);
    lines.push(`Відгуки: ${count(day, platform, 'lead_created')}`, `Записи: ${count(day, platform, 'lesson_booked')}`);
    if (index < PLATFORM_ORDER.length - 1) lines.push('');
  });
  const total = (type) => PLATFORM_ORDER.reduce((sum, platform) => sum + count(day, platform, type), 0);
  lines.push('', `Ціль по оголошенням за день: ${total('publication')}/12`, `Ціль по новим чатам за день: ${total('chat_joined')}/4`, `Ціль по відгукам за день: ${total('lead_created')}/3`, `Ціль по записам на день: ${total('lesson_booked')}/2`);
  if (extra) lines.push('', extra);
  return raw(`'Загальний звіт '||strftime('%d.%m.',${dt(day).sql})||substr(strftime('%Y',${dt(day).sql}),3)||char(10)||${lit(lines.join('\n'))}`);
}
// За вчора фінального звіту немає навмисно: на «Сьогодні» видно стан «не здано», а у «Звітах» є що здати. Є ще кілька днів без звіту.
for (let day = -28; day <= -2; day += 1) {
  if ([-9, -17, -24].includes(day)) continue;
  reportRows.push({ id: `report_${U}_${day}`, day, stale: day === -3 });
}
const reportColumns = ['id', 'user_id', 'report_date', 'report_text', 'payload_json', 'submitted_at', 'updated_at', 'revision_count', 'submitted_activity_revision'];
insert('daily_reports', reportColumns, reportRows.map((report) => ({
  id: report.id, user_id: U, report_date: dt(report.day), report_text: reportText(report.day), payload_json: JSON.stringify({ source: 'manual' }),
  submitted_at: ts(report.day, 66000), updated_at: ts(report.day, 66000), revision_count: 1,
  submitted_activity_revision: raw(report.stale ? '0' : `COALESCE((SELECT revision FROM activity_day_revisions WHERE user_id='${U}' AND event_date=${dt(report.day).sql}),0)`),
})));
// Дві версії: звіт змінено після здачі (з'являється історія версій)
for (const day of [-2, -6, -12]) {
  const report = reportRows.find((item) => item.day === day);
  if (report) sql(`UPDATE daily_reports SET report_text=${reportText(day, 'Додано вручну: два відгуки з особистих повідомлень.').sql},revision_count=2,updated_at=${ts(day, 70000).sql} WHERE id=${lit(report.id)}`);
}
// Проміжні звіти за вчора
insert('report_checkpoints', ['id', 'user_id', 'report_date', 'slot', 'report_text', 'payload_json', 'submitted_at', 'created_at', 'updated_at', 'version'],
  [['13:00', 46800], ['16:00', 57600], ['19:00', 68400]].map(([slot, sec]) => ({ id: `demo-cp-${slot.slice(0, 2)}`, user_id: U, report_date: dt(-1), slot, report_text: `Проміжний звіт ${slot}: опубліковано ${between(3, 9)} оголошень, нових відгуків ${between(0, 2)}.`,
    payload_json: '{}', submitted_at: ts(-1, sec), created_at: ts(-1, sec), updated_at: ts(-1, sec), version: 0 })));

export function demoSeedStatements() { return statements; }
export const DEMO_SEED_SUMMARY = () => ({ statements: statements.length, bytes: statements.reduce((sum, text) => sum + text.length, 0), chats: chats.length, leads: leads.length, events: events.length, publications: publications.length });
