PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('telegram', 'whatsapp', 'viber', 'facebook', 'threads')),
  name TEXT NOT NULL,
  link TEXT NOT NULL,
  normalized_link TEXT NOT NULL,
  workflow_status TEXT NOT NULL CHECK (workflow_status IN ('to_join', 'ready', 'waiting', 'failed', 'archived')),
  is_private INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER,
  processed_at INTEGER,
  snoozed_until INTEGER,
  archive_reason TEXT,
  archived_at INTEGER,
  legacy_payload_json TEXT,
  source_import_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (source_import_id) REFERENCES legacy_imports(id) ON DELETE SET NULL,
  UNIQUE (user_id, platform, normalized_link)
);

CREATE INDEX IF NOT EXISTS chats_user_platform_status_idx
  ON chats(user_id, platform, workflow_status);
CREATE INDEX IF NOT EXISTS chats_user_updated_idx
  ON chats(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_profiles (
  chat_id TEXT PRIMARY KEY NOT NULL,
  language TEXT CHECK (language IN ('uk', 'ru') OR language IS NULL),
  cadence TEXT NOT NULL DEFAULT 'any',
  weekdays_json TEXT NOT NULL DEFAULT '[]',
  directions_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'confirmed')),
  source TEXT NOT NULL DEFAULT 'legacy',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_publications (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  published_on TEXT NOT NULL,
  published_at INTEGER,
  advertisement_id TEXT,
  source TEXT NOT NULL DEFAULT 'legacy',
  source_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  UNIQUE (user_id, source_key)
);

CREATE INDEX IF NOT EXISTS chat_publications_user_date_idx
  ON chat_publications(user_id, published_on);
CREATE INDEX IF NOT EXISTS chat_publications_chat_date_idx
  ON chat_publications(chat_id, published_on);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  legacy_id TEXT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  telegram_username TEXT NOT NULL DEFAULT '',
  normalized_phone TEXT NOT NULL DEFAULT '',
  normalized_telegram TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL,
  source_chat_id TEXT,
  source_chat_link TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  needs_details INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  teacher_name TEXT NOT NULL DEFAULT '',
  lesson_platform TEXT,
  meeting_link TEXT NOT NULL DEFAULT '',
  is_student INTEGER NOT NULL DEFAULT 0,
  age_group TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  booked_at INTEGER,
  archived_at INTEGER,
  legacy_payload_json TEXT,
  source_import_id TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (source_chat_id) REFERENCES chats(id) ON DELETE SET NULL,
  FOREIGN KEY (source_import_id) REFERENCES legacy_imports(id) ON DELETE SET NULL,
  UNIQUE (user_id, legacy_id)
);

CREATE INDEX IF NOT EXISTS leads_user_status_idx ON leads(user_id, status);
CREATE INDEX IF NOT EXISTS leads_user_source_chat_idx ON leads(user_id, source_chat_id);
CREATE INDEX IF NOT EXISTS leads_user_phone_idx ON leads(user_id, normalized_phone);
CREATE INDEX IF NOT EXISTS leads_user_telegram_idx ON leads(user_id, normalized_telegram);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  legacy_id TEXT,
  name TEXT NOT NULL,
  surname TEXT NOT NULL DEFAULT '',
  age_group TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  UNIQUE (lead_id, legacy_id)
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  student_id TEXT,
  legacy_id TEXT,
  student_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  teacher_name TEXT NOT NULL DEFAULT '',
  lesson_date TEXT NOT NULL,
  lesson_time TEXT NOT NULL DEFAULT '',
  lesson_platform TEXT,
  meeting_link TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
  UNIQUE (user_id, legacy_id)
);

CREATE INDEX IF NOT EXISTS lessons_user_date_idx ON lessons(user_id, lesson_date);
CREATE INDEX IF NOT EXISTS lessons_user_teacher_idx ON lessons(user_id, teacher_name);

CREATE TABLE IF NOT EXISTS daily_reports (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  report_date TEXT NOT NULL,
  report_text TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  submitted_at INTEGER,
  updated_at INTEGER NOT NULL,
  source_import_id TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (source_import_id) REFERENCES legacy_imports(id) ON DELETE SET NULL,
  UNIQUE (user_id, report_date)
);

CREATE INDEX IF NOT EXISTS daily_reports_user_date_idx
  ON daily_reports(user_id, report_date DESC);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_import_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, setting_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (source_import_id) REFERENCES legacy_imports(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  platform TEXT,
  chat_id TEXT,
  lead_id TEXT,
  lesson_id TEXT,
  occurred_at INTEGER NOT NULL,
  event_date TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  source_key TEXT NOT NULL,
  source_import_id TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE SET NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE SET NULL,
  FOREIGN KEY (source_import_id) REFERENCES legacy_imports(id) ON DELETE SET NULL,
  UNIQUE (user_id, source_key)
);

CREATE INDEX IF NOT EXISTS activity_events_user_date_type_idx
  ON activity_events(user_id, event_date, event_type);
CREATE INDEX IF NOT EXISTS activity_events_chat_type_idx
  ON activity_events(chat_id, event_type);

CREATE TABLE IF NOT EXISTS migration_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  import_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'running', 'completed', 'failed')),
  phase TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  totals_json TEXT NOT NULL,
  processed_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (import_id) REFERENCES legacy_imports(id) ON DELETE CASCADE,
  UNIQUE (user_id, import_id)
);
