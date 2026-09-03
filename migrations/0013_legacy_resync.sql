ALTER TABLE leads ADD COLUMN response_cancelled_at INTEGER;
ALTER TABLE leads ADD COLUMN response_cancelled_date TEXT;
ALTER TABLE activity_events ADD COLUMN cancelled_at INTEGER;

CREATE INDEX IF NOT EXISTS activity_events_user_date_active_idx
  ON activity_events(user_id, event_date, event_type, cancelled_at);
