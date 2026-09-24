CREATE TABLE IF NOT EXISTS backup_exports (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  record_counts_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS backup_exports_user_created_idx
  ON backup_exports(user_id, created_at DESC);
