import type { SelectedChatView } from '@/lib/chats/telegram-selected';

export const BATCH_SIZES = [10, 25, 50] as const;
export type BatchSize = (typeof BATCH_SIZES)[number];
/** Сторінка «Уже в Work OS» і «Пропущені», а також видача пошуку. */
export const LIST_PAGE = 50;

const BATCH_KEY = 'work-os:selected-batch';
const WORK_OPEN_KEY = 'work-os:selected-in-work-open';

export function readBatchSize(): BatchSize {
  try {
    const value = Number(window.localStorage.getItem(BATCH_KEY));
    return (BATCH_SIZES as readonly number[]).includes(value) ? value as BatchSize : 10;
  } catch { return 10; }
}
export function writeBatchSize(size: BatchSize) {
  try { window.localStorage.setItem(BATCH_KEY, String(size)); } catch { /* розмір партії діє до перезавантаження */ }
}
export function readWorkOpen(): boolean {
  try { return window.localStorage.getItem(WORK_OPEN_KEY) === '1'; } catch { return false; }
}
export function writeWorkOpen(open: boolean) {
  try { window.localStorage.setItem(WORK_OPEN_KEY, open ? '1' : '0'); } catch { /* стан діє до перезавантаження */ }
}

export const formatLast = (value: string | null, year: 'numeric' | '2-digit' = 'numeric') => (value ? new Date(value).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year }) : null);

export type Split = {
  /** Нові чати, що ще не в Work OS і не пропущені, у порядку файлу (найбільше повідомлень зверху). */
  fresh: SelectedChatView[];
  /** Чати, які вже є в Work OS (будь-який статус). */
  inWork: SelectedChatView[];
  /** Пропущені, яких ще немає в Work OS. */
  skipped: SelectedChatView[];
  /** Номер чату у файлі (з 1). */
  position: Map<string, number>;
};

export function splitItems(items: readonly SelectedChatView[], dismissed: readonly string[]): Split {
  const hidden = new Set(dismissed);
  const split: Split = { fresh: [], inWork: [], skipped: [], position: new Map() };
  items.forEach((item, index) => {
    split.position.set(item.link, index + 1);
    if (item.status !== null) split.inWork.push(item);
    else if (hidden.has(item.link)) split.skipped.push(item);
    else split.fresh.push(item);
  });
  return split;
}

/** Підписи статусу чату, що вже є в Work OS; `to_join` без акаунта — серед «Нових чатів», з акаунтом — у черзі приєднання. */
const WORK_KEYS = ['ready', 'archived', 'waiting', 'queue', 'pool', 'failed'] as const;
const WORK_LABELS: Record<(typeof WORK_KEYS)[number], string> = { ready: 'публікація', archived: 'архів', waiting: 'очікування', queue: 'у черзі', pool: 'серед нових', failed: 'не вдалося' };
const workKey = (item: SelectedChatView): (typeof WORK_KEYS)[number] => {
  if (item.status === 'to_join') return item.accountId ? 'queue' : 'pool';
  return (WORK_KEYS as readonly string[]).includes(item.status ?? '') ? item.status as (typeof WORK_KEYS)[number] : 'pool';
};

export function workBreakdown(items: readonly SelectedChatView[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(workKey(item), (counts.get(workKey(item)) ?? 0) + 1);
  return WORK_KEYS.filter((key) => counts.has(key)).map((key) => `${WORK_LABELS[key]} ${counts.get(key)}`).join(' · ');
}

const STATUS_TEXT: Record<string, string> = { ready: 'Для публікації', archived: 'Архів', waiting: 'Очікування', failed: 'Не вдалося', to_join: 'Нові чати' };
export function statusText(item: SelectedChatView, accountName: (id: string | null) => string | null): string {
  const base = item.status === 'to_join' && item.accountId ? 'Черга приєднання' : STATUS_TEXT[item.status ?? ''] ?? '';
  const account = accountName(item.accountId);
  return account ? `${base} · ${account}` : base;
}

/** Пошук за назвою й посиланням по всьому списку, у порядку файлу. */
export function searchItems(items: readonly SelectedChatView[], query: string): SelectedChatView[] {
  const needle = query.trim().toLocaleLowerCase('uk-UA');
  if (!needle) return [];
  return items.filter((item) => `${item.title} ${item.link}`.toLocaleLowerCase('uk-UA').includes(needle));
}
