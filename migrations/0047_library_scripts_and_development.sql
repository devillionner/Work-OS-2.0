-- Бібліотека: розмітка скриптів для рекомендацій (етап воронки, гілка), власні версії, вбудовані шаблони,
-- колекція «Розробка» й «інтерес» ліда (гілка скрипту). Лише додаємо колонки, таблицю й індекси.
ALTER TABLE library_items ADD COLUMN stage TEXT;
ALTER TABLE library_items ADD COLUMN branch TEXT NOT NULL DEFAULT '';
ALTER TABLE library_items ADD COLUMN origin_id TEXT;
ALTER TABLE library_items ADD COLUMN template_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS library_items_template_idx ON library_items(user_id,template_key) WHERE template_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS library_items_origin_idx ON library_items(user_id,origin_id) WHERE origin_id IS NOT NULL;

-- Інтерес ліда (гілка розмови: «екзамени», «розмовна» тощо): за ним Бібліотека радить скрипт.
ALTER TABLE leads ADD COLUMN interest TEXT NOT NULL DEFAULT '';

-- «Розробка»: ідеї, баги й покращення з чекпоінтами й фото (самі файли в R2, тут лише ключі).
CREATE TABLE IF NOT EXISTS dev_items (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('idea','bug','improvement')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','doing','done','postponed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  checklist_json TEXT NOT NULL DEFAULT '[]',
  photos_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS dev_items_user_status_idx ON dev_items(user_id,archived_at,status,position);
CREATE TRIGGER IF NOT EXISTS backup_revision_dev_items_insert AFTER INSERT ON dev_items
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS backup_revision_dev_items_update AFTER UPDATE ON dev_items
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS backup_revision_dev_items_delete AFTER DELETE ON dev_items
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
