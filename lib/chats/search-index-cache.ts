// Індекс пошуку по черзі чатів (id, назва, посилання) читається з D1 цілим: пошук Unicode іде в JavaScript, бо lower() у D1 зводить
// регістр лише ASCII. Одне слово, набране літера за літерою, давало кілька повних читань черги (≈1400 рядків кожне). Індекс тримається в
// пам'яті ізоляту й прив'язаний до глобальної ревізії даних: будь-яка зміна дає нову ревізію, тож застарілих чатів у пошуку немає.
export type SearchIndexRow = { id: string; name: string; link: string; account_id: string | null };

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 6;
const entries = new Map<string, { at: number; rows: SearchIndexRow[] }>();

export function searchIndexKey(parts: Array<string | number | null>): string {
  return parts.map((part) => String(part ?? '')).join('|');
}

export function readSearchIndex(key: string, now = Date.now()): SearchIndexRow[] | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (now - entry.at > TTL_MS) { entries.delete(key); return null; }
  return entry.rows;
}

export function storeSearchIndex(key: string, rows: SearchIndexRow[], now = Date.now()): void {
  entries.delete(key);
  entries.set(key, { at: now, rows });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}
