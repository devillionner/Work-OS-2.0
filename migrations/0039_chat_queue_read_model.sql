CREATE TABLE chat_queue_counts (
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_key TEXT NOT NULL DEFAULT '',
  workflow_status TEXT NOT NULL,
  chat_count INTEGER NOT NULL DEFAULT 0 CHECK(chat_count >= 0),
  profile_confirmed_count INTEGER NOT NULL DEFAULT 0 CHECK(profile_confirmed_count >= 0),
  profile_draft_count INTEGER NOT NULL DEFAULT 0 CHECK(profile_draft_count >= 0),
  profile_empty_count INTEGER NOT NULL DEFAULT 0 CHECK(profile_empty_count >= 0),
  PRIMARY KEY(user_id,platform,account_key,workflow_status),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO chat_queue_counts (
  user_id,platform,account_key,workflow_status,chat_count,
  profile_confirmed_count,profile_draft_count,profile_empty_count
)
SELECT
  c.user_id,
  c.platform,
  CASE WHEN c.platform='telegram' THEN COALESCE(c.telegram_account_id,'') ELSE '' END,
  c.workflow_status,
  COUNT(*),
  SUM(CASE WHEN p.review_status='confirmed' THEN 1 ELSE 0 END),
  SUM(CASE WHEN p.review_status='draft' THEN 1 ELSE 0 END),
  SUM(CASE WHEN p.chat_id IS NULL THEN 1 ELSE 0 END)
FROM chats c
LEFT JOIN chat_profiles p ON p.chat_id=c.id
GROUP BY c.user_id,c.platform,CASE WHEN c.platform='telegram' THEN COALESCE(c.telegram_account_id,'') ELSE '' END,c.workflow_status;

CREATE TRIGGER chat_queue_counts_chat_insert AFTER INSERT ON chats BEGIN
  INSERT INTO chat_queue_counts(user_id,platform,account_key,workflow_status,chat_count,profile_empty_count)
  VALUES(NEW.user_id,NEW.platform,CASE WHEN NEW.platform='telegram' THEN COALESCE(NEW.telegram_account_id,'') ELSE '' END,NEW.workflow_status,1,1)
  ON CONFLICT(user_id,platform,account_key,workflow_status) DO UPDATE SET
    chat_count=chat_count+1,
    profile_empty_count=profile_empty_count+1;
END;

CREATE TRIGGER chat_queue_counts_chat_delete BEFORE DELETE ON chats BEGIN
  UPDATE chat_queue_counts SET
    chat_count=MAX(chat_count-1,0),
    profile_confirmed_count=MAX(profile_confirmed_count-(CASE WHEN COALESCE((SELECT review_status FROM chat_profiles WHERE chat_id=OLD.id),'')='confirmed' THEN 1 ELSE 0 END),0),
    profile_draft_count=MAX(profile_draft_count-(CASE WHEN COALESCE((SELECT review_status FROM chat_profiles WHERE chat_id=OLD.id),'')='draft' THEN 1 ELSE 0 END),0),
    profile_empty_count=MAX(profile_empty_count-(CASE WHEN EXISTS(SELECT 1 FROM chat_profiles WHERE chat_id=OLD.id) THEN 0 ELSE 1 END),0)
  WHERE user_id=OLD.user_id AND platform=OLD.platform
    AND account_key=CASE WHEN OLD.platform='telegram' THEN COALESCE(OLD.telegram_account_id,'') ELSE '' END
    AND workflow_status=OLD.workflow_status;
END;

CREATE TRIGGER chat_queue_counts_chat_move AFTER UPDATE OF user_id,platform,telegram_account_id,workflow_status ON chats
WHEN OLD.user_id!=NEW.user_id OR OLD.platform!=NEW.platform OR COALESCE(OLD.telegram_account_id,'')!=COALESCE(NEW.telegram_account_id,'') OR OLD.workflow_status!=NEW.workflow_status
BEGIN
  UPDATE chat_queue_counts SET
    chat_count=MAX(chat_count-1,0),
    profile_confirmed_count=MAX(profile_confirmed_count-(CASE WHEN COALESCE((SELECT review_status FROM chat_profiles WHERE chat_id=NEW.id),'')='confirmed' THEN 1 ELSE 0 END),0),
    profile_draft_count=MAX(profile_draft_count-(CASE WHEN COALESCE((SELECT review_status FROM chat_profiles WHERE chat_id=NEW.id),'')='draft' THEN 1 ELSE 0 END),0),
    profile_empty_count=MAX(profile_empty_count-(CASE WHEN EXISTS(SELECT 1 FROM chat_profiles WHERE chat_id=NEW.id) THEN 0 ELSE 1 END),0)
  WHERE user_id=OLD.user_id AND platform=OLD.platform
    AND account_key=CASE WHEN OLD.platform='telegram' THEN COALESCE(OLD.telegram_account_id,'') ELSE '' END
    AND workflow_status=OLD.workflow_status;

  INSERT INTO chat_queue_counts(user_id,platform,account_key,workflow_status,chat_count,profile_confirmed_count,profile_draft_count,profile_empty_count)
  VALUES(
    NEW.user_id,NEW.platform,CASE WHEN NEW.platform='telegram' THEN COALESCE(NEW.telegram_account_id,'') ELSE '' END,NEW.workflow_status,1,
    CASE WHEN COALESCE((SELECT review_status FROM chat_profiles WHERE chat_id=NEW.id),'')='confirmed' THEN 1 ELSE 0 END,
    CASE WHEN COALESCE((SELECT review_status FROM chat_profiles WHERE chat_id=NEW.id),'')='draft' THEN 1 ELSE 0 END,
    CASE WHEN EXISTS(SELECT 1 FROM chat_profiles WHERE chat_id=NEW.id) THEN 0 ELSE 1 END
  )
  ON CONFLICT(user_id,platform,account_key,workflow_status) DO UPDATE SET
    chat_count=chat_count+1,
    profile_confirmed_count=profile_confirmed_count+excluded.profile_confirmed_count,
    profile_draft_count=profile_draft_count+excluded.profile_draft_count,
    profile_empty_count=profile_empty_count+excluded.profile_empty_count;
END;

CREATE TRIGGER chat_queue_counts_profile_insert AFTER INSERT ON chat_profiles BEGIN
  UPDATE chat_queue_counts SET
    profile_empty_count=MAX(profile_empty_count-1,0),
    profile_confirmed_count=profile_confirmed_count+(CASE WHEN NEW.review_status='confirmed' THEN 1 ELSE 0 END),
    profile_draft_count=profile_draft_count+(CASE WHEN NEW.review_status='draft' THEN 1 ELSE 0 END)
  WHERE user_id=(SELECT user_id FROM chats WHERE id=NEW.chat_id)
    AND platform=(SELECT platform FROM chats WHERE id=NEW.chat_id)
    AND account_key=(SELECT CASE WHEN platform='telegram' THEN COALESCE(telegram_account_id,'') ELSE '' END FROM chats WHERE id=NEW.chat_id)
    AND workflow_status=(SELECT workflow_status FROM chats WHERE id=NEW.chat_id);
END;

CREATE TRIGGER chat_queue_counts_profile_review AFTER UPDATE OF review_status ON chat_profiles
WHEN OLD.review_status!=NEW.review_status
BEGIN
  UPDATE chat_queue_counts SET
    profile_confirmed_count=MAX(profile_confirmed_count-(CASE WHEN OLD.review_status='confirmed' THEN 1 ELSE 0 END),0)+(CASE WHEN NEW.review_status='confirmed' THEN 1 ELSE 0 END),
    profile_draft_count=MAX(profile_draft_count-(CASE WHEN OLD.review_status='draft' THEN 1 ELSE 0 END),0)+(CASE WHEN NEW.review_status='draft' THEN 1 ELSE 0 END)
  WHERE user_id=(SELECT user_id FROM chats WHERE id=NEW.chat_id)
    AND platform=(SELECT platform FROM chats WHERE id=NEW.chat_id)
    AND account_key=(SELECT CASE WHEN platform='telegram' THEN COALESCE(telegram_account_id,'') ELSE '' END FROM chats WHERE id=NEW.chat_id)
    AND workflow_status=(SELECT workflow_status FROM chats WHERE id=NEW.chat_id);
END;

CREATE TRIGGER chat_queue_counts_profile_delete AFTER DELETE ON chat_profiles
WHEN EXISTS(SELECT 1 FROM chats WHERE id=OLD.chat_id)
BEGIN
  UPDATE chat_queue_counts SET
    profile_confirmed_count=MAX(profile_confirmed_count-(CASE WHEN OLD.review_status='confirmed' THEN 1 ELSE 0 END),0),
    profile_draft_count=MAX(profile_draft_count-(CASE WHEN OLD.review_status='draft' THEN 1 ELSE 0 END),0),
    profile_empty_count=profile_empty_count+1
  WHERE user_id=(SELECT user_id FROM chats WHERE id=OLD.chat_id)
    AND platform=(SELECT platform FROM chats WHERE id=OLD.chat_id)
    AND account_key=(SELECT CASE WHEN platform='telegram' THEN COALESCE(telegram_account_id,'') ELSE '' END FROM chats WHERE id=OLD.chat_id)
    AND workflow_status=(SELECT workflow_status FROM chats WHERE id=OLD.chat_id);
END;

CREATE INDEX chats_user_platform_status_updated_idx
ON chats(user_id,platform,workflow_status,updated_at DESC,id);

CREATE INDEX chats_user_account_status_updated_idx
ON chats(user_id,telegram_account_id,workflow_status,updated_at DESC,id);

CREATE INDEX chat_discovery_candidates_owner_imported_updated_idx
ON chat_discovery_candidates(user_id,imported_chat_id,updated_at DESC,id);
