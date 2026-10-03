-- Telegram warmup reads two SUM(CASE...) aggregates over activity_events filtered by
-- (user_id, telegram_account_id, event_type) with cancelled_at IS NULL; without this index it walked
-- every event of the account (measured: 31 000 + 31 000 rows per account over ~10 calls/day).
CREATE INDEX IF NOT EXISTS activity_events_user_account_type_idx
  ON activity_events(user_id, telegram_account_id, event_type, cancelled_at);

-- "Published today" (app/api/chats + readPublicationState) joined chat_publications to chats and
-- filtered by c.platform after the join, so it read every publication of the owner across all
-- platforms for the day instead of just the requested one (measured: ~165 rows per call to return ~3).
-- platform is immutable per chat and set at insert time by every writer (lib/chats/publication.ts,
-- lib/reports/publication-correction.ts, the legacy migrate route); backfill covers existing rows.
ALTER TABLE chat_publications ADD COLUMN platform TEXT;
UPDATE chat_publications SET platform=(SELECT platform FROM chats WHERE id=chat_publications.chat_id)
  WHERE platform IS NULL;
CREATE INDEX IF NOT EXISTS chat_publications_user_platform_date_idx
  ON chat_publications(user_id, platform, published_on);

-- Analytics archive-reason breakdown (app/api/analytics/route.ts) filtered workflow_status='archived'
-- and an archived_at range without any index covering workflow_status, so it walked every chat of the
-- owner (SEARCH on the (user_id) prefix of an unrelated index) instead of just the archived ones in range.
CREATE INDEX IF NOT EXISTS chats_user_status_archived_idx
  ON chats(user_id, workflow_status, archived_at);
