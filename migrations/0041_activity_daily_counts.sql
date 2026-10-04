-- Daily activity counters for Analytics/Today/goals. Each bucket is keyed only by columns of the event
-- row itself (platform as stored; '~none' when the event has none, distinct from a stored ''), so a
-- counter is a pure function of activity_events and can never drift from it: editing a lead or a chat
-- does not touch any bucket.
-- Events without their own platform (lead events, bulk adds) are still attributed live through their
-- lead/chat by lib/activity-summary.ts, found through the partial index below.
-- active_count = not cancelled; cancelled_count keeps the bucket visible exactly like the former
-- GROUP BY over all events of the range did (a platform with only cancelled events still had a row).
CREATE TABLE activity_daily_counts (
  user_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  event_type TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '~none',
  active_count INTEGER NOT NULL DEFAULT 0 CHECK(active_count >= 0),
  cancelled_count INTEGER NOT NULL DEFAULT 0 CHECK(cancelled_count >= 0),
  PRIMARY KEY(user_id,event_date,event_type,platform),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO activity_daily_counts(user_id,event_date,event_type,platform,active_count,cancelled_count)
SELECT user_id,event_date,event_type,COALESCE(platform,'~none'),
  SUM(CASE WHEN cancelled_at IS NULL THEN 1 ELSE 0 END),
  SUM(CASE WHEN cancelled_at IS NULL THEN 0 ELSE 1 END)
FROM activity_events
GROUP BY user_id,event_date,event_type,COALESCE(platform,'~none');

CREATE TRIGGER activity_daily_counts_event_insert AFTER INSERT ON activity_events BEGIN
  INSERT INTO activity_daily_counts(user_id,event_date,event_type,platform,active_count,cancelled_count)
  VALUES(NEW.user_id,NEW.event_date,NEW.event_type,COALESCE(NEW.platform,'~none'),
    CASE WHEN NEW.cancelled_at IS NULL THEN 1 ELSE 0 END,
    CASE WHEN NEW.cancelled_at IS NULL THEN 0 ELSE 1 END)
  ON CONFLICT(user_id,event_date,event_type,platform) DO UPDATE SET
    active_count=active_count+excluded.active_count,
    cancelled_count=cancelled_count+excluded.cancelled_count;
END;

CREATE TRIGGER activity_daily_counts_event_delete AFTER DELETE ON activity_events BEGIN
  UPDATE activity_daily_counts SET
    active_count=MAX(active_count-(CASE WHEN OLD.cancelled_at IS NULL THEN 1 ELSE 0 END),0),
    cancelled_count=MAX(cancelled_count-(CASE WHEN OLD.cancelled_at IS NULL THEN 0 ELSE 1 END),0)
  WHERE user_id=OLD.user_id AND event_date=OLD.event_date AND event_type=OLD.event_type AND platform=COALESCE(OLD.platform,'~none');
END;

CREATE TRIGGER activity_daily_counts_event_move AFTER UPDATE OF user_id,event_date,event_type,platform,cancelled_at ON activity_events
WHEN OLD.user_id!=NEW.user_id OR OLD.event_date!=NEW.event_date OR OLD.event_type!=NEW.event_type
  OR COALESCE(OLD.platform,'~none')!=COALESCE(NEW.platform,'~none') OR (OLD.cancelled_at IS NULL)!=(NEW.cancelled_at IS NULL)
BEGIN
  UPDATE activity_daily_counts SET
    active_count=MAX(active_count-(CASE WHEN OLD.cancelled_at IS NULL THEN 1 ELSE 0 END),0),
    cancelled_count=MAX(cancelled_count-(CASE WHEN OLD.cancelled_at IS NULL THEN 0 ELSE 1 END),0)
  WHERE user_id=OLD.user_id AND event_date=OLD.event_date AND event_type=OLD.event_type AND platform=COALESCE(OLD.platform,'~none');

  INSERT INTO activity_daily_counts(user_id,event_date,event_type,platform,active_count,cancelled_count)
  VALUES(NEW.user_id,NEW.event_date,NEW.event_type,COALESCE(NEW.platform,'~none'),
    CASE WHEN NEW.cancelled_at IS NULL THEN 1 ELSE 0 END,
    CASE WHEN NEW.cancelled_at IS NULL THEN 0 ELSE 1 END)
  ON CONFLICT(user_id,event_date,event_type,platform) DO UPDATE SET
    active_count=active_count+excluded.active_count,
    cancelled_count=cancelled_count+excluded.cancelled_count;
END;

-- Events without their own platform are the only ones still resolved through leads/chats at read time;
-- this keeps finding them proportional to their own (small) number instead of every event of the range.
CREATE INDEX activity_events_user_date_unplatformed_idx
  ON activity_events(user_id,event_date,event_type) WHERE platform IS NULL;
