-- НЕ ЗАСТОСОВАНО. Цю міграцію винесено з `migrations/`, бо збірки Workers Builds для staging падали на кроці
-- `deploy:staging` (автозастосування міграцій), і staging залишався на 3.1.0. Перед поверненням у `migrations/`
-- переглянь лог збірки в дашборді Cloudflare й перевір, чи тригери `lead_duplicate_insert` / `lead_duplicate_update`
-- на staging існують (їх міг зняти невдалий запуск). Повернення: `git mv` назад у `migrations/` разом з рішенням власника.
-- Native lead writes check for a duplicate contact in a BEFORE trigger. The original condition
-- ((phone<>'' AND normalized_phone=?) OR (telegram<>'' AND normalized_telegram=?)) cannot use the phone or
-- telegram indexes as one predicate, so SQLite walked every lead of the owner through
-- leads_owner_archive_updated_idx on each edit that changed a contact (measured on staging: 12 updates/day,
-- ~7 700 rows read per call, 92 640 rows total). Splitting it into two EXISTS makes each branch an index seek
-- (leads_user_phone_idx / leads_user_telegram_idx); the semantics and the abort message stay identical.
-- Keep trigger body statements on one physical line for Wrangler remote migration parsing.
DROP TRIGGER IF EXISTS lead_duplicate_insert;
DROP TRIGGER IF EXISTS lead_duplicate_update;
CREATE TRIGGER lead_duplicate_insert BEFORE INSERT ON leads WHEN NEW.managed_at IS NOT NULL AND NEW.duplicate_state='none'
BEGIN
 SELECT CASE WHEN (NEW.normalized_phone<>'' AND EXISTS(SELECT 1 FROM leads WHERE user_id=NEW.user_id AND normalized_phone=NEW.normalized_phone)) OR (NEW.normalized_telegram<>'' AND EXISTS(SELECT 1 FROM leads WHERE user_id=NEW.user_id AND normalized_telegram=NEW.normalized_telegram)) THEN RAISE(ABORT,'lead_duplicate_contact') END;
END;
CREATE TRIGGER lead_duplicate_update BEFORE UPDATE OF normalized_phone,normalized_telegram ON leads
WHEN NEW.managed_at IS NOT NULL AND NEW.duplicate_state='none' AND (OLD.normalized_phone<>NEW.normalized_phone OR OLD.normalized_telegram<>NEW.normalized_telegram)
BEGIN
 SELECT CASE WHEN (NEW.normalized_phone<>'' AND EXISTS(SELECT 1 FROM leads WHERE user_id=NEW.user_id AND id<>NEW.id AND normalized_phone=NEW.normalized_phone)) OR (NEW.normalized_telegram<>'' AND EXISTS(SELECT 1 FROM leads WHERE user_id=NEW.user_id AND id<>NEW.id AND normalized_telegram=NEW.normalized_telegram)) THEN RAISE(ABORT,'lead_duplicate_contact') END;
END;
