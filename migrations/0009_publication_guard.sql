CREATE UNIQUE INDEX IF NOT EXISTS chat_publications_user_chat_day_idx
  ON chat_publications(user_id, chat_id, published_on);
