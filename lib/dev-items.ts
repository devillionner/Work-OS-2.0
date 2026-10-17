// «Розробка»: ідеї, баги й покращення з чекпоінтами й фото. Чисті функції валідації; обмеження тут і на сервері однакові.
export const DEV_TYPES = ['idea', 'bug', 'improvement'] as const;
export const DEV_STATUSES = ['idea', 'doing', 'done', 'postponed'] as const;
export const DEV_PRIORITIES = ['low', 'normal', 'high'] as const;
export type DevType = (typeof DEV_TYPES)[number];
export type DevStatus = (typeof DEV_STATUSES)[number];
export type DevPriority = (typeof DEV_PRIORITIES)[number];
export type ChecklistItem = { id: string; text: string; done: boolean };
export type DevPhoto = { key: string; name: string; bytes: number };
export type DevItem = {
  id: string; type: DevType; title: string; body: string; status: DevStatus; priority: DevPriority;
  checklist: ChecklistItem[]; photos: DevPhoto[]; notes: string; position: number; version: number;
  archivedAt: number | null; createdAt: number; updatedAt: number;
};

export const DEV_TYPE_LABEL: Record<DevType, string> = { idea: 'Ідея', bug: 'Баг', improvement: 'Покращення' };
export const DEV_STATUS_LABEL: Record<DevStatus, string> = { idea: 'Ідея', doing: 'В роботі', done: 'Готово', postponed: 'Відкладено' };
export const DEV_PRIORITY_LABEL: Record<DevPriority, string> = { low: 'Низький', normal: 'Звичайний', high: 'Високий' };

export const CHECKLIST_LIMIT = 40;
export const PHOTO_LIMIT = 12;
export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null => (typeof value === 'string' && (list as readonly string[]).includes(value) ? value as T : null);
export const cleanDevType = (value: unknown) => oneOf(DEV_TYPES, value);
export const cleanDevStatus = (value: unknown) => oneOf(DEV_STATUSES, value);
export const cleanDevPriority = (value: unknown) => oneOf(DEV_PRIORITIES, value);
export const cleanDevText = (value: unknown, max: number) => (typeof value === 'string' ? Array.from(value.replace(/\r\n/g, '\n').replace(/[^\S\n]+/g, ' ').normalize('NFC').trim()).slice(0, max).join('') : '');

export function cleanChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  const items: ChecklistItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const text = cleanDevText(item.text, 300).replace(/\n+/g, ' ');
    if (!text) continue;
    items.push({ id: typeof item.id === 'string' && item.id.length <= 60 && item.id ? item.id : crypto.randomUUID(), text, done: item.done === true });
    if (items.length >= CHECKLIST_LIMIT) break;
  }
  return items;
}

/** Фото належить власнику: ключ починається з його префікса, інші ключі відкидаються. */
export const photoPrefix = (userId: string) => `dev/${userId}/`;
export function cleanPhotos(value: unknown, userId: string): DevPhoto[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const photos: DevPhoto[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.key !== 'string' || !item.key.startsWith(photoPrefix(userId)) || item.key.length > 200 || seen.has(item.key) || !/^[\w./-]+$/.test(item.key)) continue;
    seen.add(item.key);
    photos.push({ key: item.key, name: cleanDevText(item.name, 120) || 'фото', bytes: Number.isFinite(Number(item.bytes)) ? Math.max(0, Math.floor(Number(item.bytes))) : 0 });
    if (photos.length >= PHOTO_LIMIT) break;
  }
  return photos;
}

export function parseJsonList<T>(json: string | null | undefined): T[] {
  try { const parsed: unknown = JSON.parse(json || '[]'); return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; }
}

/** Прогрес чекліста: «2 з 5» і частка. */
export function checklistProgress(items: readonly ChecklistItem[]): { done: number; total: number; ratio: number } {
  const done = items.filter((item) => item.done).length;
  return { done, total: items.length, ratio: items.length ? done / items.length : 0 };
}

/** Короткий текст задачі для вставки в чат з Claude: тип, назва, пріоритет, опис, чекпоінти й нотатки. */
export function taskText(item: Pick<DevItem, 'type' | 'title' | 'body' | 'priority' | 'checklist' | 'notes' | 'photos'>): string {
  const lines = [`${DEV_TYPE_LABEL[item.type]}: ${item.title}`];
  if (item.priority !== 'normal') lines.push(`Пріоритет: ${DEV_PRIORITY_LABEL[item.priority].toLowerCase()}`);
  if (item.body.trim()) lines.push('', item.body.trim());
  if (item.checklist.length) lines.push('', 'Чекпоінти:', ...item.checklist.map((entry) => `- [${entry.done ? 'x' : ' '}] ${entry.text}`));
  if (item.notes.trim()) lines.push('', `Нотатки: ${item.notes.trim()}`);
  if (item.photos.length) lines.push('', `Фото: ${item.photos.length} (у Work OS, «Розробка»)`);
  return lines.join('\n');
}
