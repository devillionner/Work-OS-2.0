CREATE TABLE IF NOT EXISTS migration_job_chunks (
  job_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (job_id, phase, chunk_index),
  FOREIGN KEY (job_id) REFERENCES migration_jobs(id) ON DELETE CASCADE
);
