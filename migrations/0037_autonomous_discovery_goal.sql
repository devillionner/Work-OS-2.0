ALTER TABLE chat_discovery_runs ADD COLUMN target_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_discovery_runs ADD COLUMN completion_reason TEXT;
ALTER TABLE chat_discovery_runs ADD COLUMN source_lease_device_id TEXT;
ALTER TABLE chat_discovery_runs ADD COLUMN source_lease_expires_at INTEGER;

ALTER TABLE chat_discovery_candidates ADD COLUMN discovery_run_id TEXT;

CREATE INDEX chat_discovery_candidates_run_decision_idx
ON chat_discovery_candidates(user_id,discovery_run_id,decision,updated_at);

CREATE INDEX chat_discovery_runs_source_lease_idx
ON chat_discovery_runs(user_id,status,source_lease_expires_at,updated_at);
