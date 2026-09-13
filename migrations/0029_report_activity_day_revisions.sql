ALTER TABLE daily_reports ADD COLUMN submitted_activity_revision INTEGER;

CREATE TABLE activity_day_revisions (
  user_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id,event_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO activity_day_revisions(user_id,event_date,revision)
SELECT user_id,event_date,COUNT(*)
FROM activity_events
GROUP BY user_id,event_date;

CREATE TRIGGER activity_day_revision_insert AFTER INSERT ON activity_events
BEGIN
  INSERT INTO activity_day_revisions(user_id,event_date,revision)
  VALUES(NEW.user_id,NEW.event_date,1)
  ON CONFLICT(user_id,event_date) DO UPDATE SET revision=revision+1;
END;

CREATE TRIGGER activity_day_revision_update AFTER UPDATE ON activity_events
BEGIN
  INSERT INTO activity_day_revisions(user_id,event_date,revision)
  VALUES(OLD.user_id,OLD.event_date,1)
  ON CONFLICT(user_id,event_date) DO UPDATE SET revision=revision+1;
  INSERT INTO activity_day_revisions(user_id,event_date,revision)
  SELECT NEW.user_id,NEW.event_date,1
  WHERE NEW.user_id!=OLD.user_id OR NEW.event_date!=OLD.event_date
  ON CONFLICT(user_id,event_date) DO UPDATE SET revision=revision+1;
END;

CREATE TRIGGER activity_day_revision_delete AFTER DELETE ON activity_events
BEGIN
  INSERT INTO activity_day_revisions(user_id,event_date,revision)
  VALUES(OLD.user_id,OLD.event_date,1)
  ON CONFLICT(user_id,event_date) DO UPDATE SET revision=revision+1;
END;
