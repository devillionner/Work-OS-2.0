CREATE TABLE goal_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  goal_key TEXT NOT NULL CHECK(goal_key IN ('daily_booking_goal','monthly_booking_goal')),
  effective_on TEXT NOT NULL,
  value INTEGER NOT NULL CHECK(value >= 0 AND value <= 100000),
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('baseline','manual','restore')),
  version INTEGER NOT NULL CHECK(version > 0),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id,goal_key,version)
);

CREATE INDEX goal_versions_lookup_idx
ON goal_versions(user_id,goal_key,effective_on DESC,version DESC);

INSERT INTO goal_versions(id,user_id,goal_key,effective_on,value,created_at,source,version)
SELECT 'goal_baseline_' || lower(hex(randomblob(12))), user_id, setting_key, '0001-01-01',
  CAST(value_json AS INTEGER), updated_at, 'baseline', 1
FROM user_settings
WHERE setting_key IN ('daily_booking_goal','monthly_booking_goal');
CREATE TRIGGER backup_revision_goal_versions_insert AFTER INSERT ON goal_versions
BEGIN
  INSERT INTO backup_revisions(user_id,revision) VALUES (NEW.user_id,1)
  ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;

CREATE TRIGGER backup_revision_goal_versions_update AFTER UPDATE ON goal_versions
BEGIN
  INSERT INTO backup_revisions(user_id,revision) VALUES (OLD.user_id,1)
  ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
  INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id!=OLD.user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;

CREATE TRIGGER backup_revision_goal_versions_delete AFTER DELETE ON goal_versions
BEGIN
  INSERT INTO backup_revisions(user_id,revision) VALUES (OLD.user_id,1)
  ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
