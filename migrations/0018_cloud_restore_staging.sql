ALTER TABLE backup_exports ADD COLUMN revision INTEGER;

CREATE TABLE cloud_restore_imports (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  source_schema_version INTEGER NOT NULL,
  source_revision INTEGER NOT NULL,
  current_revision_at_stage INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  record_counts_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','restoring','completed','failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, sha256)
);

CREATE INDEX cloud_restore_imports_user_created_idx
  ON cloud_restore_imports(user_id, created_at DESC);

CREATE TABLE cloud_restore_chunks (
  import_id TEXT NOT NULL REFERENCES cloud_restore_imports(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  PRIMARY KEY (import_id, table_name, chunk_index)
);

CREATE INDEX cloud_restore_chunks_import_order_idx
  ON cloud_restore_chunks(import_id, table_name, chunk_index);
