PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS legacy_imports (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  source_schema_version INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'staged',
  summary_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, sha256)
);

CREATE TABLE IF NOT EXISTS legacy_import_chunks (
  import_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  payload_chunk TEXT NOT NULL,
  PRIMARY KEY (import_id, chunk_index),
  FOREIGN KEY (import_id) REFERENCES legacy_imports(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS legacy_imports_user_created_idx
  ON legacy_imports(user_id, created_at DESC);
