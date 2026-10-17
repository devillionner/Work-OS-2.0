import { LIBRARY_ADVERTISEMENT_PLATFORMS, canonicalLibraryPlatform, cleanLibraryPlatforms, type LibraryAdvertisementPlatform } from '@/lib/library';
import { canonicalKnownSubject, type CanonicalSubject } from '@/lib/subjects';

/** Колекції, що живуть у `library_items`; «Розробка» має власну таблицю й екран. */
export type LibraryCollectionKey = 'advertisement' | 'official_script' | 'personal_script' | 'knowledge';
export type Collection = LibraryCollectionKey | 'development';
export type Item = {
  id: string;
  kind: 'advertisement' | 'script';
  collection: Collection;
  version: number;
  title: string;
  ukText: string;
  ruText: string;
  notes: string;
  tags: string[];
  platforms: string[];
  /** Етап воронки скрипту (порожньо — будь-який), гілка (інтерес ліда), оригінал для власної версії й ключ вбудованого шаблону. */
  stage: string | null;
  branch: string;
  originId: string | null;
  templateKey: string | null;
  usedTodayPlatforms: string[];
  archivedAt: number | null;
  updatedAt: number;
};
export type Form = { title: string; ukText: string; ruText: string; notes: string; tags: string[]; platforms: string[]; stage: string; branch: string };

export const COLLECTIONS: ReadonlyArray<{ value: Collection; label: string }> = [
  { value: 'advertisement', label: 'Оголошення' },
  { value: 'official_script', label: 'Офіційні скрипти' },
  { value: 'personal_script', label: 'Особисті скрипти' },
  { value: 'knowledge', label: 'База знань' },
  { value: 'development', label: 'Розробка' },
];

export const collectionLabel = (collection: Collection) => COLLECTIONS.find((item) => item.value === collection)?.label ?? collection;

export function newForm(collection: LibraryCollectionKey): Form {
  return { title: '', ukText: '', ruText: '', notes: '', tags: [], platforms: collection === 'advertisement' ? [...LIBRARY_ADVERTISEMENT_PLATFORMS] : [], stage: '', branch: '' };
}

export function formFromItem(item: Item): Form {
  const known = cleanLibraryPlatforms(item.platforms);
  const platforms = item.collection === 'advertisement' ? (item.platforms.length === 0 ? [...LIBRARY_ADVERTISEMENT_PLATFORMS] : known) : item.platforms;
  return { title: item.title, ukText: item.ukText, ruText: item.ruText, notes: item.notes, tags: [...item.tags], platforms: [...platforms], stage: item.stage ?? '', branch: item.branch };
}

export function splitList(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

export function updatePlatformChoice(current: string[], value: LibraryAdvertisementPlatform, checked: boolean): string[] {
  const canonical = cleanLibraryPlatforms(current);
  return checked ? [...new Set([...canonical, value])] : canonical.filter((item) => item !== value);
}

export function updateDirectionChoice(current: string[], subject: CanonicalSubject, checked: boolean): string[] {
  const rest = current.filter((tag) => canonicalKnownSubject(tag) !== subject);
  return checked ? [...rest, subject] : rest;
}

export function displayPlatforms(values: string[]): string[] {
  if (values.length === 0) return ['all'];
  const known = cleanLibraryPlatforms(values);
  const extras = [...new Set(values.filter((value) => !canonicalLibraryPlatform(value)).map((value) => value.trim()).filter(Boolean))];
  return [...known, ...extras];
}

export function platformLabel(value: string): string {
  return ({ all: 'Усі платформи', telegram: 'Telegram', whatsapp: 'WhatsApp', viber: 'Viber', facebook: 'Facebook' } as Record<string, string>)[value.toLowerCase()] || value;
}

export function matchesPlatform(item: Item, filter: string): boolean {
  return filter === 'all' || item.platforms.length === 0 || item.platforms.some((value) => canonicalLibraryPlatform(value) === filter);
}

export function formatStamp(epochSeconds: number): string {
  return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Kyiv' }).format(new Date(epochSeconds * 1000));
}

export type ViberSafeJob = {
  id: string;
  status: 'pending' | 'claimed' | 'sent' | 'failed' | 'cancelled';
  updatedAt?: number;
  result: Record<string, unknown> | null;
};

export function viberJobStatus(status: ViberSafeJob['status']): string {
  return ({
    pending: 'очікує executor',
    claimed: 'виконується',
    sent: 'підтверджено в «Мої нотатки»',
    failed: 'завершено без підтвердженої відправки',
    cancelled: 'скасовано',
  } as const)[status];
}
