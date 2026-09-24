CREATE TABLE messenger_automation_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('viber')),
  mode TEXT NOT NULL CHECK (mode IN ('safe_note')),
  target_key TEXT NOT NULL CHECK (target_key IN ('my_notes')),
  advertisement_id TEXT NOT NULL,
  advertisement_version INTEGER NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('uk','ru')),
  payload_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','claimed','sent','failed','cancelled')),
  active_key TEXT UNIQUE,
  executor_device_id TEXT,
  lease_expires_at INTEGER,
  result_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(advertisement_id) REFERENCES library_items(id) ON DELETE RESTRICT,
  UNIQUE(user_id,request_key)
);

CREATE INDEX messenger_automation_jobs_owner_status_idx
ON messenger_automation_jobs(user_id,status,created_at);

CREATE INDEX messenger_automation_jobs_executor_lease_idx
ON messenger_automation_jobs(user_id,executor_device_id,lease_expires_at);
