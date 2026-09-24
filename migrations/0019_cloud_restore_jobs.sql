CREATE TABLE cloud_restore_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  import_id TEXT NOT NULL REFERENCES cloud_restore_imports(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  phase TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL,
  processed_chunks INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (user_id, import_id)
);

CREATE INDEX cloud_restore_jobs_user_updated_idx
  ON cloud_restore_jobs(user_id, updated_at DESC);
