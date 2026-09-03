CREATE TABLE IF NOT EXISTS telegram_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  account_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  is_selected INTEGER NOT NULL DEFAULT 0,
  join_streak INTEGER NOT NULL DEFAULT 0,
  join_batch_size INTEGER NOT NULL DEFAULT 5,
  break_minutes INTEGER NOT NULL DEFAULT 15,
  break_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, account_number)
);

CREATE INDEX IF NOT EXISTS telegram_accounts_user_order_idx
  ON telegram_accounts(user_id, is_enabled DESC, account_number);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_accounts_one_selected_idx
  ON telegram_accounts(user_id) WHERE is_selected = 1;

INSERT OR IGNORE INTO telegram_accounts
  (id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at)
SELECT id || ':tg1',id,1,'TG 1',1,1,created_at,last_login_at FROM users;

ALTER TABLE chats ADD COLUMN telegram_account_id TEXT REFERENCES telegram_accounts(id) ON DELETE SET NULL;
ALTER TABLE chat_publications ADD COLUMN telegram_account_id TEXT REFERENCES telegram_accounts(id) ON DELETE SET NULL;
ALTER TABLE activity_events ADD COLUMN telegram_account_id TEXT REFERENCES telegram_accounts(id) ON DELETE SET NULL;

UPDATE chats
SET telegram_account_id = user_id || ':tg1'
WHERE platform = 'telegram' AND workflow_status != 'to_join' AND telegram_account_id IS NULL;

UPDATE chat_publications
SET telegram_account_id = user_id || ':tg1'
WHERE telegram_account_id IS NULL
  AND chat_id IN (SELECT id FROM chats WHERE platform = 'telegram');

UPDATE activity_events
SET telegram_account_id = user_id || ':tg1'
WHERE platform = 'telegram' AND telegram_account_id IS NULL;

CREATE INDEX IF NOT EXISTS chats_user_telegram_account_status_idx
  ON chats(user_id, telegram_account_id, workflow_status);
CREATE INDEX IF NOT EXISTS publications_user_telegram_account_date_idx
  ON chat_publications(user_id, telegram_account_id, published_on);

