-- Keep Telegram keyword-matrix progress independent from public-web fallback progress.
ALTER TABLE chat_discovery_runs ADD COLUMN telegram_cursor INTEGER NOT NULL DEFAULT 0;
