-- The live Telegram-group-scan search path (2026-10-04, lib/chat-discovery/public-web.ts) tags every
-- source it finds with kind 'telegram_scanned', and local-preview.ts's own SOURCE_KINDS allowlist
-- already accepted it — but this column's CHECK constraint (migrations/0031_chat_discovery.sql) was
-- never updated, so every "Підтвердити" on a candidate found through the current search flow failed
-- with a generic 500 at the final INSERT. SQLite cannot ALTER a CHECK constraint in place, so the
-- table is recreated with the widened constraint and its rows copied over unchanged.
CREATE TABLE chat_discovery_sources_new (
  id TEXT PRIMARY KEY NOT NULL,
  candidate_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('public_web','curated','manual','telegram_global','telegram_scanned')),
  source_url TEXT NOT NULL DEFAULT '',
  source_title TEXT NOT NULL DEFAULT '',
  query_text TEXT NOT NULL DEFAULT '',
  seed_label TEXT NOT NULL DEFAULT '',
  seed_kind TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  discovered_at INTEGER NOT NULL,
  FOREIGN KEY(candidate_id) REFERENCES chat_discovery_candidates(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(candidate_id,source_key)
);

INSERT INTO chat_discovery_sources_new
  (id,candidate_id,user_id,source_key,source_kind,source_url,source_title,query_text,seed_label,seed_kind,context,discovered_at)
SELECT id,candidate_id,user_id,source_key,source_kind,source_url,source_title,query_text,seed_label,seed_kind,context,discovered_at
FROM chat_discovery_sources;

DROP TABLE chat_discovery_sources;

ALTER TABLE chat_discovery_sources_new RENAME TO chat_discovery_sources;

CREATE INDEX chat_discovery_sources_owner_candidate_idx
ON chat_discovery_sources(user_id,candidate_id,discovered_at DESC);
