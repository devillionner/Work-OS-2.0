export const LEGACY_BACKUP_APP = 'prototype-checker-full-backup';
export const LEGACY_BACKUP_MAX_BYTES = 10 * 1024 * 1024;

const PLATFORM_STORAGE_KEYS = {
  telegram: 'telegram-groups-checklist-v1',
  whatsapp: 'whatsapp-groups-checklist-v1',
  viber: 'viber-groups-checklist-v1',
  facebook: 'facebook-groups-checklist-v1',
} as const;

export type LegacyPlatformSummary = {
  total: number;
  joined: number;
  waiting: number;
  failed: number;
  pending: number;
  profiles: number;
  publications: number;
};

export type LegacyBackupSummary = {
  storageKeys: number;
  chats: number;
  archivedChats: number;
  leads: number;
  lessons: number;
  reports: number;
  platforms: Record<keyof typeof PLATFORM_STORAGE_KEYS, LegacyPlatformSummary>;
  invalidSections: string[];
};

export type LegacyBackupInspection = {
  valid: boolean;
  schemaVersion: number | null;
  createdAt: string | null;
  summary: LegacyBackupSummary;
  errors: string[];
  warnings: string[];
};

type LegacyBackup = {
  app?: unknown;
  schemaVersion?: unknown;
  createdAt?: unknown;
  storage?: unknown;
};

type LegacyGroup = {
  status?: unknown;
  contentProfile?: { reviewStatus?: unknown };
  publicationDates?: unknown;
  lessons?: unknown;
};

export function inspectLegacyBackup(raw: string): LegacyBackupInspection {
  const errors: string[] = [];
  const warnings: string[] = [];
  const summary = emptySummary();
  let parsed: LegacyBackup;

  try {
    parsed = JSON.parse(raw) as LegacyBackup;
  } catch {
    return {
      valid: false,
      schemaVersion: null,
      createdAt: null,
      summary,
      errors: ['Файл не є коректним JSON.'],
      warnings,
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    errors.push('У файлі немає об’єкта резервної копії.');
  }
  if (parsed.app !== LEGACY_BACKUP_APP) {
    errors.push('Це не повна резервна копія старого Work OS.');
  }

  const schemaVersion = Number(parsed.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    errors.push('Не вдалося визначити версію старої бази.');
  } else if (schemaVersion > 2) {
    warnings.push('Копія створена новішою версією старого застосунку — перед перенесенням потрібна додаткова перевірка.');
  }

  const storage = isStringRecord(parsed.storage) ? parsed.storage : null;
  if (!storage) {
    errors.push('У копії немає розділу storage.');
  } else {
    summary.storageKeys = Object.keys(storage).length;
    for (const [platform, key] of Object.entries(PLATFORM_STORAGE_KEYS) as Array<
      [keyof typeof PLATFORM_STORAGE_KEYS, string]
    >) {
      const groups = parseArraySection(storage, key, summary.invalidSections);
      const platformSummary = summary.platforms[platform];
      platformSummary.total = groups.length;
      platformSummary.joined = groups.filter((group) => group.status === '✅').length;
      platformSummary.waiting = groups.filter((group) => group.status === '⏳').length;
      platformSummary.failed = groups.filter((group) => group.status === '❌').length;
      platformSummary.pending = groups.filter((group) => !group.status).length;
      platformSummary.profiles = groups.filter(
        (group) => group.contentProfile?.reviewStatus === 'confirmed',
      ).length;
      platformSummary.publications = groups.reduce(
        (total, group) =>
          total + (Array.isArray(group.publicationDates) ? group.publicationDates.length : 0),
        0,
      );
      summary.chats += groups.length;
    }

    const archive = parseObjectSection(
      storage,
      'deleted-groups-archive-v1',
      summary.invalidSections,
    );
    summary.archivedChats = Object.values(archive).reduce<number>(
      (total, entries) => total + (Array.isArray(entries) ? entries.length : 0),
      0,
    );

    const leads = parseArraySection(storage, 'shared-leads-v1', summary.invalidSections);
    summary.leads = leads.length;
    summary.lessons = leads.reduce(
      (total, lead) => total + (Array.isArray(lead.lessons) ? lead.lessons.length : 0),
      0,
    );

    const reports = parseObjectOrArraySection(
      storage,
      'daily-report-history-v1',
      summary.invalidSections,
    );
    summary.reports = Array.isArray(reports)
      ? reports.length
      : Object.keys(reports).length;
  }

  if (summary.invalidSections.length) {
    warnings.push(
      `${summary.invalidSections.length} розділ(и) не вдалося прочитати; вони не будуть підтверджені автоматично.`,
    );
  }
  if (!summary.chats && !summary.leads && !summary.reports) {
    warnings.push('У копії не знайдено чатів, лідів або звітів.');
  }

  return {
    valid: errors.length === 0,
    schemaVersion: Number.isInteger(schemaVersion) ? schemaVersion : null,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
    summary,
    errors,
    warnings,
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function emptyPlatformSummary(): LegacyPlatformSummary {
  return {
    total: 0,
    joined: 0,
    waiting: 0,
    failed: 0,
    pending: 0,
    profiles: 0,
    publications: 0,
  };
}

function emptySummary(): LegacyBackupSummary {
  return {
    storageKeys: 0,
    chats: 0,
    archivedChats: 0,
    leads: 0,
    lessons: 0,
    reports: 0,
    platforms: {
      telegram: emptyPlatformSummary(),
      whatsapp: emptyPlatformSummary(),
      viber: emptyPlatformSummary(),
      facebook: emptyPlatformSummary(),
    },
    invalidSections: [],
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === 'string');
}

function parseStoredValue(
  storage: Record<string, string>,
  key: string,
  invalidSections: string[],
): unknown {
  const raw = storage[key];
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    invalidSections.push(key);
    return null;
  }
}

function parseArraySection(
  storage: Record<string, string>,
  key: string,
  invalidSections: string[],
): LegacyGroup[] {
  const value = parseStoredValue(storage, key, invalidSections);
  if (value === null) return [];
  if (!Array.isArray(value)) {
    invalidSections.push(key);
    return [];
  }
  return value.filter(
    (entry): entry is LegacyGroup => Boolean(entry && typeof entry === 'object'),
  );
}

function parseObjectSection(
  storage: Record<string, string>,
  key: string,
  invalidSections: string[],
): Record<string, unknown> {
  const value = parseStoredValue(storage, key, invalidSections);
  if (value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidSections.push(key);
    return {};
  }
  return value as Record<string, unknown>;
}

function parseObjectOrArraySection(
  storage: Record<string, string>,
  key: string,
  invalidSections: string[],
): Record<string, unknown> | unknown[] {
  const value = parseStoredValue(storage, key, invalidSections);
  if (value === null) return {};
  if (!value || typeof value !== 'object') {
    invalidSections.push(key);
    return {};
  }
  return value as Record<string, unknown> | unknown[];
}
