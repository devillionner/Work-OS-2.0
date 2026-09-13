ALTER TABLE chat_profiles ADD COLUMN custom_interval_days INTEGER CHECK (custom_interval_days IS NULL OR (custom_interval_days>=1 AND custom_interval_days<=3650));
ALTER TABLE chat_profiles ADD COLUMN next_allowed_on TEXT CHECK (next_allowed_on IS NULL OR next_allowed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
UPDATE chat_profiles SET review_status='draft' WHERE cadence='custom' AND review_status='confirmed';
