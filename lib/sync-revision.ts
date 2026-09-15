export async function readSyncRevision(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare('SELECT revision FROM backup_revisions WHERE user_id=?1 LIMIT 1')
    .bind(userId)
    .first<{ revision: number }>();
  return Number(row?.revision || 0);
}
