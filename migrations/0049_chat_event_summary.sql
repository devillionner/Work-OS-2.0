-- D1 read budget (2026-10-18, d1 insights): the chat list read 8-25 rows per list row, because every row ran subqueries
-- over activity_events (snooze count, leave mark, last state event, last publication event for the state token).
-- chat_event_summary keeps exactly those four values per chat, updated by triggers on activity_events, so a list row
-- reads one primary-key row instead of walking the chat's event history. Events are only inserted (cancelled_at is the
-- only later change and none of the four values depends on it), so the summary cannot drift from the events.
CREATE TABLE chat_event_summary (
  chat_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  snooze_count INTEGER NOT NULL DEFAULT 0,
  left_at INTEGER,
  last_state_event_id TEXT,
  last_publication_event_id TEXT
);

-- One pass over the events that matter: state events need their action, publications are counted from the index alone.
INSERT INTO chat_event_summary(chat_id,user_id,snooze_count,left_at,last_state_event_id,last_publication_event_id)
SELECT c.id,c.user_id,g.snoozes,
  (SELECT IIF(json_extract(le.metadata_json,'$.action')='confirm_leave',le.occurred_at,NULL) FROM activity_events le WHERE le.rowid=g.last_leave_rowid),
  (SELECT e.id FROM activity_events e WHERE e.rowid=g.last_state_rowid),
  (SELECT p.id FROM activity_events p WHERE p.rowid=g.last_publication_rowid)
FROM (
  SELECT chat_id,
    SUM(IIF(event_type='chat_state_changed' AND action='snooze',1,0)) AS snoozes,
    MAX(IIF(event_type='chat_state_changed',rid,NULL)) AS last_state_rowid,
    MAX(IIF(event_type='chat_state_changed' AND action IN ('confirm_leave','undo_leave','joined','approved'),rid,NULL)) AS last_leave_rowid,
    MAX(IIF(event_type='publication',rid,NULL)) AS last_publication_rowid
  FROM (
    SELECT chat_id,event_type,rowid AS rid,IIF(event_type='chat_state_changed',json_extract(metadata_json,'$.action'),NULL) AS action
    FROM activity_events
    WHERE chat_id IS NOT NULL AND event_type IN ('chat_state_changed','publication'))
  GROUP BY chat_id
) g
JOIN chats c ON c.id=g.chat_id;

CREATE TRIGGER chat_event_summary_state_insert AFTER INSERT ON activity_events
WHEN NEW.chat_id IS NOT NULL AND NEW.event_type='chat_state_changed'
BEGIN
 INSERT INTO chat_event_summary(chat_id,user_id,snooze_count,left_at,last_state_event_id)
 VALUES(NEW.chat_id,NEW.user_id,
  IIF(json_valid(NEW.metadata_json),IIF(json_extract(NEW.metadata_json,'$.action')='snooze',1,0),0),
  IIF(json_valid(NEW.metadata_json),IIF(json_extract(NEW.metadata_json,'$.action')='confirm_leave',NEW.occurred_at,NULL),NULL),
  NEW.id)
 ON CONFLICT(chat_id) DO UPDATE SET
  snooze_count=snooze_count+excluded.snooze_count,
  left_at=IIF(json_valid(NEW.metadata_json),IIF(json_extract(NEW.metadata_json,'$.action') IN ('confirm_leave','undo_leave','joined','approved'),excluded.left_at,left_at),left_at),
  last_state_event_id=excluded.last_state_event_id;
END;

CREATE TRIGGER chat_event_summary_publication_insert AFTER INSERT ON activity_events
WHEN NEW.chat_id IS NOT NULL AND NEW.event_type='publication'
BEGIN
 INSERT INTO chat_event_summary(chat_id,user_id,last_publication_event_id) VALUES(NEW.chat_id,NEW.user_id,NEW.id)
 ON CONFLICT(chat_id) DO UPDATE SET last_publication_event_id=excluded.last_publication_event_id;
END;

CREATE TRIGGER chat_event_summary_chat_delete AFTER DELETE ON chats
BEGIN
 DELETE FROM chat_event_summary WHERE chat_id=OLD.id;
END;
