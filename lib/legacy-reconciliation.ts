import { sha256Hex } from './legacy-backup.ts';
import type { LegacyMigrationDataset, MigrationPhase } from './legacy-migration.ts';

export type MigrationChunkReconciliation = {
  phase: MigrationPhase;
  expected: number;
  actual: number;
  expectedChecksum: string;
  actualChecksum: string;
  ok: boolean;
};

export type MigrationPhaseReconciliation = {
  expected: number;
  verified: number;
  expectedChecksum: string;
  actualChecksum: string;
  ok: boolean;
};

export type MigrationReconciliation = Partial<Record<MigrationPhase, MigrationPhaseReconciliation>>;

export async function reconcileMigrationChunk(
  db: D1Database,
  userId: string,
  phase: MigrationPhase,
  records: LegacyMigrationDataset[MigrationPhase],
): Promise<MigrationChunkReconciliation> {
  const expectedKeys = (records as unknown[]).map((record) => recordKey(phase, record));
  if (expectedKeys.some((key) => !key)) throw new Error(`Не вдалося звірити етап ${phase}: відсутній стабільний ключ.`);
  const uniqueKeys = [...new Set(expectedKeys)];
  const found = uniqueKeys.length ? await readExistingKeys(db, userId, phase, uniqueKeys) : new Set<string>();
  // Preserve source multiplicity: duplicate source records are considered verified when
  // their single stable target identity exists. This matches idempotent migration semantics.
  const actualKeys = expectedKeys.filter((key) => found.has(key));
  const expectedChecksum = await keyChecksum(expectedKeys);
  const actualChecksum = await keyChecksum(actualKeys);
  return {
    phase,
    expected: expectedKeys.length,
    actual: actualKeys.length,
    expectedChecksum,
    actualChecksum,
    ok: actualKeys.length === expectedKeys.length && actualChecksum === expectedChecksum,
  };
}

export async function appendMigrationReconciliation(
  current: MigrationReconciliation,
  phase: MigrationPhase,
  phaseTotal: number,
  cursor: number,
  chunk: MigrationChunkReconciliation,
): Promise<MigrationReconciliation> {
  const previous = current[phase];
  const previousVerified = previous?.verified || 0;
  if (previousVerified !== cursor) {
    throw new Error(`Стан звірки етапу ${phase} не збігається з прогресом переносу.`);
  }
  const expectedChecksum = await chainChecksum(previous?.expectedChecksum || '', chunk.expectedChecksum);
  const actualChecksum = await chainChecksum(previous?.actualChecksum || '', chunk.actualChecksum);
  const verified = cursor + chunk.expected;
  return {
    ...current,
    [phase]: {
      expected: phaseTotal,
      verified,
      expectedChecksum,
      actualChecksum,
      ok: Boolean(chunk.ok && expectedChecksum === actualChecksum && verified <= phaseTotal),
    },
  };
}

export function reconciliationComplete(
  value: MigrationReconciliation,
  phases: readonly MigrationPhase[],
): boolean {
  return phases.every((phase) => {
    const row = value[phase];
    return Boolean(row && row.ok && row.verified === row.expected);
  });
}

export function parseMigrationReconciliation(value: string | null | undefined): MigrationReconciliation {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: MigrationReconciliation = {};
    for (const [phase, row] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isMigrationPhase(phase) || !row || typeof row !== 'object' || Array.isArray(row)) continue;
      const value = row as Record<string, unknown>;
      const expected = Number(value.expected);
      const verified = Number(value.verified);
      const expectedChecksum = typeof value.expectedChecksum === 'string' ? value.expectedChecksum : '';
      const actualChecksum = typeof value.actualChecksum === 'string' ? value.actualChecksum : '';
      if (!Number.isSafeInteger(expected) || expected < 0 || !Number.isSafeInteger(verified) || verified < 0) continue;
      result[phase] = {
        expected,
        verified,
        expectedChecksum,
        actualChecksum,
        ok: value.ok === true && expectedChecksum === actualChecksum,
      };
    }
    return result;
  } catch {
    return {};
  }
}

function recordKey(phase: MigrationPhase, value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const row = value as Record<string, unknown>;
  if (phase === 'profiles') return text(row.chatId);
  if (phase === 'settings') return text(row.key);
  return text(row.id);
}

async function readExistingKeys(
  db: D1Database,
  userId: string,
  phase: MigrationPhase,
  keys: string[],
): Promise<Set<string>> {
  const encoded = JSON.stringify(keys);
  let statement: D1PreparedStatement;
  if (phase === 'accounts') {
    statement = db.prepare(`SELECT id AS key FROM telegram_accounts
      WHERE user_id=?1 AND id IN (SELECT value FROM json_each(?2))`).bind(userId, encoded);
  } else if (phase === 'profiles') {
    statement = db.prepare(`SELECT p.chat_id AS key FROM chat_profiles p
      JOIN chats c ON c.id=p.chat_id
      WHERE c.user_id=?1 AND p.chat_id IN (SELECT value FROM json_each(?2))`).bind(userId, encoded);
  } else if (phase === 'settings') {
    statement = db.prepare(`SELECT setting_key AS key FROM user_settings
      WHERE user_id=?1 AND setting_key IN (SELECT value FROM json_each(?2))`).bind(userId, encoded);
  } else {
    const table = phaseTable(phase);
    statement = db.prepare(`SELECT id AS key FROM ${table}
      WHERE user_id=?1 AND id IN (SELECT value FROM json_each(?2))`).bind(userId, encoded);
  }
  const result = await statement.all<{ key: string }>();
  return new Set(result.results.map((row) => row.key));
}

function phaseTable(phase: MigrationPhase): string {
  const tables: Record<Exclude<MigrationPhase, 'accounts' | 'profiles' | 'settings'>, string> = {
    chats: 'chats',
    publications: 'chat_publications',
    leads: 'leads',
    students: 'students',
    lessons: 'lessons',
    curatorRequests: 'curator_requests',
    reports: 'daily_reports',
    events: 'activity_events',
  };
  if (phase === 'accounts' || phase === 'profiles' || phase === 'settings') throw new Error('Для етапу потрібен спеціальний запит.');
  return tables[phase];
}

async function keyChecksum(keys: string[]): Promise<string> {
  return sha256Hex([...keys].sort().join('\n'));
}

async function chainChecksum(previous: string, next: string): Promise<string> {
  return sha256Hex(`${previous}\n${next}`);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isMigrationPhase(value: string): value is MigrationPhase {
  return ['accounts','chats','profiles','publications','leads','students','lessons','curatorRequests','reports','settings','events'].includes(value);
}
