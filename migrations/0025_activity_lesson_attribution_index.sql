CREATE INDEX IF NOT EXISTS activity_events_user_lesson_type_idx
ON activity_events(user_id, lesson_id, event_type, cancelled_at);
