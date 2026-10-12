-- НЕ ЗАСТОСОВАНО. Цю міграцію винесено з `migrations/`: збірки Workers Builds для staging падали на її автозастосуванні.
-- Найімовірніша причина (докази — `node scripts/d1-insights.mjs --limit 400 --time-period 7d`: `DROP TRIGGER … insert` ×10,
-- `CREATE TRIGGER … insert` ×14, `CREATE TRIGGER … update` жодного разу, запису `0043` у `d1_migrations` немає): файл на
-- віддаленій D1 виконує серверний імпорт (Wrangler лише вантажить його в R2), а не локальний сплітер Wrangler. Імпорт атомарний
-- («якщо виконання не завершилось, БД повертається до початкового стану»), і тіло тригера тут містить рядок
-- `SELECT CASE … END;`, що закінчується на `END;` перед справжнім `END;` тригера, — схоже, серверний розбір вважає це кінцем
-- тригера й падає на неповному `CREATE TRIGGER`. Тому DROP-и виконувалися, але весь імпорт відкочувався: тригери на staging лишилися старі.
-- Перед поверненням у `migrations/` перепиши тригери без `CASE … END;` (умова в `WHEN`, тіло `SELECT RAISE(ABORT,'…');`)
-- і перевір лог збірки в дашборді Cloudflare. Повернення — разом із рішенням власника.
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
