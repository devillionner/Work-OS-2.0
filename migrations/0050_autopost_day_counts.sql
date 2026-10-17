-- D1 read budget (2026-10-18, d1 insights): the autopost progress («10 з 30», runner tray) counted every job of the day on each
-- live-channel event, so a batch of n jobs cost about n reads per event (259 calls a day, avg 171 rows). autopost_day_counts keeps
-- one counter per day, platform, status and outcome, moved by triggers when a job is created, changes status or outcome, or is
-- removed, so the progress reads a dozen counter rows whatever the batch size.
CREATE TABLE autopost_day_counts (
  user_id TEXT NOT NULL,
  published_on TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT '',
  job_count INTEGER NOT NULL DEFAULT 0 CHECK(job_count >= 0),
  PRIMARY KEY(user_id,published_on,platform,status,outcome)
);

INSERT INTO autopost_day_counts(user_id,published_on,platform,status,outcome,job_count)
SELECT j.user_id,j.published_on,c.platform,j.status,COALESCE(j.outcome,''),COUNT(*)
FROM whatsapp_autopost_jobs j JOIN chats c ON c.id=j.chat_id AND c.user_id=j.user_id
GROUP BY j.user_id,j.published_on,c.platform,j.status,COALESCE(j.outcome,'');

CREATE TRIGGER autopost_day_counts_insert AFTER INSERT ON whatsapp_autopost_jobs
BEGIN
 INSERT INTO autopost_day_counts(user_id,published_on,platform,status,outcome,job_count)
 SELECT NEW.user_id,NEW.published_on,c.platform,NEW.status,COALESCE(NEW.outcome,''),1 FROM chats c WHERE c.id=NEW.chat_id
 ON CONFLICT(user_id,published_on,platform,status,outcome) DO UPDATE SET job_count=job_count+1;
END;

CREATE TRIGGER autopost_day_counts_update AFTER UPDATE OF status,outcome ON whatsapp_autopost_jobs
WHEN OLD.status!=NEW.status OR COALESCE(OLD.outcome,'')!=COALESCE(NEW.outcome,'')
BEGIN
 UPDATE autopost_day_counts SET job_count=MAX(job_count-1,0)
 WHERE user_id=OLD.user_id AND published_on=OLD.published_on AND status=OLD.status AND outcome=COALESCE(OLD.outcome,'')
  AND platform=(SELECT platform FROM chats WHERE id=OLD.chat_id);
 INSERT INTO autopost_day_counts(user_id,published_on,platform,status,outcome,job_count)
 SELECT NEW.user_id,NEW.published_on,c.platform,NEW.status,COALESCE(NEW.outcome,''),1 FROM chats c WHERE c.id=NEW.chat_id
 ON CONFLICT(user_id,published_on,platform,status,outcome) DO UPDATE SET job_count=job_count+1;
END;

CREATE TRIGGER autopost_day_counts_delete AFTER DELETE ON whatsapp_autopost_jobs
BEGIN
 UPDATE autopost_day_counts SET job_count=MAX(job_count-1,0)
 WHERE user_id=OLD.user_id AND published_on=OLD.published_on AND status=OLD.status AND outcome=COALESCE(OLD.outcome,'')
  AND platform=(SELECT platform FROM chats WHERE id=OLD.chat_id);
END;
