CREATE TABLE chat_discovery_runs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled')),
  platforms_json TEXT NOT NULL,
  goal INTEGER NOT NULL CHECK(goal BETWEEN 1 AND 100),
  min_members INTEGER NOT NULL CHECK(min_members BETWEEN 1 AND 10000000),
  source_cursor INTEGER NOT NULL DEFAULT 0 CHECK(source_cursor >= 0),
  searched_queries INTEGER NOT NULL DEFAULT 0 CHECK(searched_queries >= 0),
  found_count INTEGER NOT NULL DEFAULT 0 CHECK(found_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK(duplicate_count >= 0),
  imported_count INTEGER NOT NULL DEFAULT 0 CHECK(imported_count >= 0),
  error_message TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX chat_discovery_runs_one_active_idx
ON chat_discovery_runs(user_id)
WHERE status='running';

CREATE INDEX chat_discovery_runs_owner_updated_idx
ON chat_discovery_runs(user_id,updated_at DESC);

CREATE TABLE chat_discovery_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('whatsapp','viber','telegram','facebook')),
  name TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL,
  normalized_link TEXT NOT NULL,
  discovered_at INTEGER NOT NULL,
  checked_at INTEGER,
  member_count INTEGER CHECK(member_count IS NULL OR member_count >= 0),
  chat_type TEXT NOT NULL DEFAULT 'unknown' CHECK(chat_type IN ('unknown','group','community','channel','contact','bot')),
  activity_state TEXT NOT NULL DEFAULT 'unknown' CHECK(activity_state IN ('unknown','active','dead')),
  topic_match TEXT NOT NULL DEFAULT 'unknown' CHECK(topic_match IN ('unknown','match','mismatch')),
  can_write INTEGER CHECK(can_write IS NULL OR can_write IN (0,1)),
  ads_policy TEXT NOT NULL DEFAULT 'unknown' CHECK(ads_policy IN ('unknown','allowed','inferred_allowed','operator_confirmed','forbidden')),
  membership_state TEXT NOT NULL DEFAULT 'not_checked' CHECK(membership_state IN ('not_checked','pending','joined','left')),
  access_state TEXT NOT NULL DEFAULT 'unknown' CHECK(access_state IN ('unknown','available','unavailable')),
  link_state TEXT NOT NULL DEFAULT 'valid' CHECK(link_state IN ('unknown','valid','invalid')),
  inspection_state TEXT NOT NULL DEFAULT 'not_checked' CHECK(inspection_state IN ('not_checked','inspected','failed')),
  decision TEXT NOT NULL DEFAULT 'review' CHECK(decision IN ('review','target','rejected','unavailable')),
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  imported_chat_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(imported_chat_id) REFERENCES chats(id) ON DELETE SET NULL,
  UNIQUE(user_id,platform,normalized_link)
);

CREATE INDEX chat_discovery_candidates_owner_decision_idx
ON chat_discovery_candidates(user_id,decision,updated_at DESC);

CREATE INDEX chat_discovery_candidates_owner_platform_idx
ON chat_discovery_candidates(user_id,platform,updated_at DESC);

CREATE TABLE chat_discovery_sources (
  id TEXT PRIMARY KEY NOT NULL,
  candidate_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('public_web','curated','manual','telegram_global')),
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

CREATE INDEX chat_discovery_sources_owner_candidate_idx
ON chat_discovery_sources(user_id,candidate_id,discovered_at DESC);
