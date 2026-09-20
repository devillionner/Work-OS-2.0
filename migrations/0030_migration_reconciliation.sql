-- Persist bounded migration reconciliation state per job.
ALTER TABLE migration_jobs ADD COLUMN reconciliation_json TEXT NOT NULL DEFAULT '{}';
