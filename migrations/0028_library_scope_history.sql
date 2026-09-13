ALTER TABLE library_items ADD COLUMN collection TEXT NOT NULL DEFAULT 'advertisement'
  CHECK (collection IN ('advertisement','official_script','personal_script','knowledge'));

UPDATE library_items
SET collection=CASE WHEN kind='advertisement' THEN 'advertisement' ELSE 'personal_script' END;

CREATE INDEX IF NOT EXISTS library_items_user_collection_idx
  ON library_items(user_id,collection,archived_at,updated_at DESC);

CREATE TABLE IF NOT EXISTS library_item_versions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','archive','restore')),
  kind TEXT NOT NULL CHECK (kind IN ('advertisement','script')),
  collection TEXT NOT NULL CHECK (collection IN ('advertisement','official_script','personal_script','knowledge')),
  title TEXT NOT NULL,
  uk_text TEXT NOT NULL DEFAULT '',
  ru_text TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  platforms_json TEXT NOT NULL DEFAULT '[]',
  archived_at INTEGER,
  saved_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES library_items(id) ON DELETE CASCADE,
  UNIQUE (item_id,version_number)
);

CREATE INDEX IF NOT EXISTS library_item_versions_owner_item_idx
  ON library_item_versions(user_id,item_id,version_number DESC);

INSERT INTO library_item_versions
  (id,user_id,item_id,version_number,action,kind,collection,title,uk_text,ru_text,notes,tags_json,platforms_json,archived_at,saved_at)
SELECT lower(hex(randomblob(16))),user_id,id,1,'create',kind,collection,title,uk_text,ru_text,notes,tags_json,platforms_json,archived_at,updated_at
FROM library_items
WHERE NOT EXISTS (SELECT 1 FROM library_item_versions v WHERE v.item_id=library_items.id);
