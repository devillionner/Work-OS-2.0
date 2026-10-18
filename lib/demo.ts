// Публічна демо-версія (воркер `work-os-demo`): усе демо-специфічне вмикається лише змінною DEMO_MODE цього воркера.
// У staging і production цей файл підключає тільки екран (смуга «Демо-версія») та генератор сиду, на їхню поведінку він не впливає.
export const DEMO_USER_ID = 'demo-owner';
export const DEMO_EMAIL = 'demo@example.test';
export const DEMO_NAME = 'Демо-оператор';
/** Токен сесії демо-власника. Не секрет: у демо-базі немає жодних справжніх даних, а вхід і так відкритий для всіх. */
export const DEMO_SESSION_TOKEN = 'work-os-demo-public-session';
export const DEMO_DB_NAME = 'work-os-demo-db';
export const DEMO_BLOCKED_TEXT = 'У демо-версії недоступно';

/** Заголовок відповіді, за яким екран показує Toast замість роботи дії. */
export const DEMO_BLOCK_HEADER = 'x-demo-blocked';
/** Подія window, якою екран просить показати Toast про недоступну дію (вихід тощо), коли запиту до сервера немає. */
export const DEMO_BLOCKED_EVENT = 'work-os-demo-blocked';
export type DemoBlockKind = 'unavailable' | 'rate' | 'writes' | 'reads';

export const DEMO_BLOCK_MESSAGES: Record<DemoBlockKind, string> = {
  unavailable: DEMO_BLOCKED_TEXT,
  rate: 'Забагато запитів поспіль. Зачекайте хвилину',
  writes: 'Ліміт змін на сьогодні вичерпано: запис знову запрацює після нічного скидання',
  reads: 'Ліміт демо на сьогодні вичерпано: спробуйте після нічного скидання',
};

export function isDemoEmail(email: string | null | undefined): boolean {
  return email === DEMO_EMAIL;
}

/**
 * Дії, які в демо не виконуються: зовнішні сервіси, runner, резервні копії, вхід і вихід, сховище файлів.
 * Кнопки лишаються видимими, сервер відповідає 403 із заголовком `x-demo-blocked`, а екран показує Toast.
 * @param method HTTP-метод у верхньому регістрі
 */
export function isDemoBlocked(method: string, pathname: string): boolean {
  const read = method === 'GET' || method === 'HEAD';
  if (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/backups/')) return true;
  if (pathname === '/api/chat-discovery' || pathname.startsWith('/api/chat-discovery/')) return true;
  if (pathname.startsWith('/api/imports/legacy')) return true;
  if (pathname === '/api/chats/names' || pathname.startsWith('/audit-access')) return true;
  if (pathname.startsWith('/api/messenger-automation/')) return true;
  if (pathname === '/api/messenger-automation') return !read;
  if (pathname.startsWith('/api/dev-items/files') || pathname.startsWith('/api/leads/attachments')) return !read;
  return false;
}

/** Північ за Києвом у секундах Unix: від неї SQL сиду рахує всі дати («сьогодні» демо-даних). */
export function kyivMidnight(nowMs: number): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(nowMs)).map((part) => [part.type, part.value]));
  return Math.floor(nowMs / 1000) - (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second));
}
