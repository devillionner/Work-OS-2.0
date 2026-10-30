-- Дублікати чатів без сканування всієї таблиці (2026-10-30). Менеджер дублікатів і перевірка «уже в Work OS» читали всі чати власника
-- (до 10 тис. рядків на виклик). Тепер ключі збігу (канонічне посилання й нормалізована назва, їх рахує JS) лежать в окремій таблиці
-- з первинним ключем (user_id,kind,key,chat_id), а «підозрілі» чати позначені в chat_dup_flags: менеджер читає лише їх.
-- chat_dup_pending — черга чатів, ключі яких треба перерахувати: її наповнюють тригери (новий чат, зміна назви чи посилання),
-- а розбирає sweepChatDuplicateIndex порціями. Відновлення з копії теж вставляє чати, тож тригер підхоплює й їх.
CREATE TABLE chat_dup_keys (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, key, chat_id),
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX chat_dup_keys_chat_idx ON chat_dup_keys(chat_id);

CREATE TABLE chat_dup_flags (
  chat_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX chat_dup_flags_user_idx ON chat_dup_flags(user_id);

CREATE TABLE chat_dup_pending (
  chat_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX chat_dup_pending_user_idx ON chat_dup_pending(user_id);

INSERT INTO chat_dup_pending(chat_id,user_id) SELECT id,user_id FROM chats;

CREATE TRIGGER chat_dup_pending_insert AFTER INSERT ON chats
BEGIN
  INSERT OR IGNORE INTO chat_dup_pending(chat_id,user_id) VALUES(NEW.id,NEW.user_id);
END;

CREATE TRIGGER chat_dup_pending_update AFTER UPDATE OF name,link,normalized_link ON chats
BEGIN
  INSERT OR IGNORE INTO chat_dup_pending(chat_id,user_id) VALUES(NEW.id,NEW.user_id);
END;
