import { cleanLibraryBody, cleanLibraryBranch, cleanLibraryStage, cleanLibraryTags, cleanLibraryText } from './library.ts';
import { joinClarifier } from './script-notes.ts';

// Імпорт скриптів із таблиць: пакет збирається поза репозиторієм (там ціни й робочі тексти) і завантажується файлом у «Бібліотека → Імпорт з таблиці».
// Пакет — групи: скрипт із однією версією або кілька різних версій одного скрипту (з обох таблиць), щоб власник бачив їх поруч і вибирав.

export type ImportTemplateKey = 'lesson_booked' | 'reminder_day' | 'reminder_hour';
export type ImportVersion = {
  id: string;
  source: 'new' | 'old' | 'both';
  /** Підпис версії: «нова», «стара», «стара · називає суму». */
  label: string;
  title: string;
  /** Текст українською, вже з полями-шаблонами. */
  text: string;
  /** Уточнююче питання, яке пишемо першим. */
  question: string;
  stage: string | null;
  tags: string[];
  branch: string;
  note: string;
  templateKey?: ImportTemplateKey;
};
export type ImportGroup = {
  id: string;
  title: string;
  /** Розділ для групування в перегляді. */
  section: string;
  order: number;
  versions: ImportVersion[];
  /** Версії, які імпортуються за замовчуванням (рекомендація). */
  recommended: string[];
  why: string;
};
export type ImportPackage = { format: 'work-os-scripts-import'; version: 1; groups: ImportGroup[] };

/** Те, що йде на сервер: одна версія, яку власник вибрав, уже з остаточною назвою. */
export type ImportEntry = {
  title: string;
  text: string;
  question: string;
  note: string;
  stage: string | null;
  tags: string[];
  branch: string;
  templateKey: ImportTemplateKey | null;
  /** Місце в колекції: менше — вище (порядок аркуша таблиці). */
  rank: number;
};

export const IMPORT_CHUNK = 20;
export const IMPORT_MAX_GROUPS = 600;
const TEMPLATE_KEYS: readonly string[] = ['lesson_booked', 'reminder_day', 'reminder_hour'];
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null);

/** Розбір файлу пакета; помилка — читабельне повідомлення українською. */
export function parseImportPackage(source: string): ImportPackage {
  let raw: unknown;
  try { raw = JSON.parse(source); } catch { throw new Error('Це не файл пакета скриптів: його не вдалося прочитати.'); }
  const pack = record(raw);
  if (!pack || pack.format !== 'work-os-scripts-import' || pack.version !== 1 || !Array.isArray(pack.groups)) throw new Error('Це не файл пакета скриптів Work OS.');
  if (pack.groups.length > IMPORT_MAX_GROUPS) throw new Error('У пакеті забагато скриптів.');
  const groups: ImportGroup[] = [];
  for (const item of pack.groups) {
    const group = record(item);
    if (!group || !Array.isArray(group.versions) || !group.versions.length || group.versions.length > 12) continue;
    const versions: ImportVersion[] = [];
    for (const entry of group.versions) {
      const version = record(entry);
      if (!version) continue;
      const body = text(version.text, 20000);
      const id = text(version.id, 120);
      if (!id || !body.trim()) continue;
      const stage = cleanLibraryStage(version.stage);
      const templateKey = typeof version.templateKey === 'string' && TEMPLATE_KEYS.includes(version.templateKey) ? version.templateKey as ImportTemplateKey : undefined;
      versions.push({
        id, source: version.source === 'new' || version.source === 'both' ? version.source : 'old', label: text(version.label, 80), title: text(version.title, 200), text: body,
        question: text(version.question, 4000), stage, tags: Array.isArray(version.tags) ? version.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 20) : [],
        branch: text(version.branch, 80), note: text(version.note, 4000), ...(templateKey ? { templateKey } : {}),
      });
    }
    if (!versions.length) continue;
    const ids = new Set(versions.map((version) => version.id));
    const recommended = Array.isArray(group.recommended) ? group.recommended.filter((id): id is string => typeof id === 'string' && ids.has(id)) : [];
    groups.push({ id: text(group.id, 120) || versions[0].id, title: text(group.title, 200) || versions[0].title, section: text(group.section, 120), order: Number(group.order) || groups.length, versions, recommended, why: text(group.why, 1200) });
  }
  if (!groups.length) throw new Error('У пакеті немає жодного скрипту.');
  return { format: 'work-os-scripts-import', version: 1, groups };
}

/** Назва готового скрипту: якщо з однієї групи беруть кілька версій, до назви додається підпис версії. */
export function entryTitle(group: ImportGroup, version: ImportVersion, selectedInGroup: number): string {
  return selectedInGroup > 1 ? `${version.title} · ${version.label}` : version.title;
}

/** Сервер: перевірка й очищення одного запису (усе, що прийшло з браузера, вважається неперевіреним). */
export function cleanImportEntry(value: unknown): ImportEntry | null {
  const entry = record(value);
  if (!entry) return null;
  const title = cleanLibraryText(entry.title, 200);
  const body = cleanLibraryBody(entry.text, 20000);
  if (!title || !body.trim()) return null;
  const templateKey = typeof entry.templateKey === 'string' && TEMPLATE_KEYS.includes(entry.templateKey) ? entry.templateKey as ImportTemplateKey : null;
  const rank = Number(entry.rank);
  return {
    title, text: body,
    question: cleanLibraryBody(entry.question, 2000).trim(),
    note: cleanLibraryBody(entry.note, 2000).trim(),
    stage: cleanLibraryStage(entry.stage),
    tags: cleanLibraryTags(entry.tags),
    branch: cleanLibraryBranch(entry.branch),
    templateKey,
    rank: Number.isFinite(rank) && rank >= 0 && rank < 100000 ? Math.floor(rank) : 0,
  };
}

/** Нотатка скрипту з уточнюючого питання й додаткової нотатки. */
export const entryNotes = (entry: Pick<ImportEntry, 'question' | 'note'>) => joinClarifier(entry.question, entry.note);
