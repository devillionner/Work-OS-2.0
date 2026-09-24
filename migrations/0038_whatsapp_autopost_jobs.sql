CREATE TABLE whatsapp_autopost_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  expected_name TEXT NOT NULL,
  expected_link TEXT NOT NULL,
  chat_state_token TEXT NOT NULL,
  advertisement_id TEXT NOT NULL,
  advertisement_version INTEGER NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('uk','ru')),
  payload_text TEXT NOT NULL,
  published_on TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','claimed','sent','failed','cancelled')),
  active_key TEXT UNIQUE,
  executor_device_id TEXT,
  lease_expires_at INTEGER,
  result_json TEXT,
  publication_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY(advertisement_id) REFERENCES library_items(id) ON DELETE RESTRICT,
  UNIQUE(user_id,request_key)
);

CREATE INDEX whatsapp_autopost_jobs_owner_status_idx
ON whatsapp_autopost_jobs(user_id,status,created_at);

CREATE INDEX whatsapp_autopost_jobs_executor_lease_idx
ON whatsapp_autopost_jobs(user_id,executor_device_id,lease_expires_at);

CREATE INDEX whatsapp_autopost_jobs_chat_date_idx
ON whatsapp_autopost_jobs(user_id,chat_id,published_on,status);
