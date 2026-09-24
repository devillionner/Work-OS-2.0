CREATE TABLE IF NOT EXISTS library_items (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('advertisement','script')),
  title TEXT NOT NULL,
  uk_text TEXT NOT NULL DEFAULT '',
  ru_text TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  platforms_json TEXT NOT NULL DEFAULT '[]',
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS library_items_user_kind_idx ON library_items(user_id,kind,archived_at,updated_at DESC);
CREATE TRIGGER library_items_revision_insert AFTER INSERT ON library_items
BEGIN
 INSERT INTO backup_revisions(user_id,revision) VALUES (NEW.user_id,1)
 ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER library_items_revision_update AFTER UPDATE ON library_items
BEGIN
 INSERT INTO backup_revisions(user_id,revision) VALUES (OLD.user_id,1)
 ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) VALUES (NEW.user_id,1)
 ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
