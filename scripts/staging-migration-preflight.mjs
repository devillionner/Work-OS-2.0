const MIGRATION_NAME = /\b\d{4}_[A-Za-z0-9._-]+\.sql\b/g;

export function parseStagingMigrationList(output) {
  const text = String(output || '');

  if (/No migrations to apply!/i.test(text)) {
    return { pending: false, names: [] };
  }

  const names = [...new Set(text.match(MIGRATION_NAME) || [])];
  if (names.length > 0) {
    return { pending: true, names };
  }

  throw new Error('Could not determine staging migration state from Wrangler output.');
}