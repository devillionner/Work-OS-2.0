CREATE TABLE auth_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  provider_subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  picture_url TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_subject),
  UNIQUE (provider, email)
);

CREATE INDEX auth_identities_user_idx
  ON auth_identities(user_id, last_login_at DESC);

-- Before this migration users.id was the verified Google `sub`.
-- Preserve that identity while allowing additional Google accounts to map
-- to the same canonical Work OS workspace owner.
INSERT OR IGNORE INTO auth_identities (
  provider, provider_subject, user_id, email, display_name,
  picture_url, created_at, last_login_at
)
SELECT
  'google', id, id, lower(email), display_name,
  picture_url, created_at, last_login_at
FROM users;
