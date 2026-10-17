-- Лід без відомого контакту (немає ні номера, ні Telegram-ніка) і ручні нагадування ліду. Лише додаємо колонки й індекси.
-- contact_unknown: 1 — контакт ще невідомий; фільтр «Без контакту» читає частковий індекс і не сканує всіх лідів.
ALTER TABLE leads ADD COLUMN contact_unknown INTEGER NOT NULL DEFAULT 0;
-- Існуючі ліди без номера й ніка вже по суті «без контакту»: позначаємо їх одноразово.
UPDATE leads SET contact_unknown=1 WHERE normalized_phone='' AND normalized_telegram='';
CREATE INDEX IF NOT EXISTS leads_contact_unknown_idx
  ON leads(user_id,updated_at DESC,id)
  WHERE contact_unknown=1 AND archived_at IS NULL;

-- Ручні нагадування ліду: масив JSON [{id,text,at,doneAt}] у самому ліді (нова таблиця потребувала б правок резервних копій),
-- next_custom_reminder_at — найближчий час невиконаного нагадування для запиту «Сьогодні» без розбору JSON.
ALTER TABLE leads ADD COLUMN custom_reminders_json TEXT;
ALTER TABLE leads ADD COLUMN next_custom_reminder_at INTEGER;
CREATE INDEX IF NOT EXISTS leads_custom_reminder_due_idx
  ON leads(user_id,next_custom_reminder_at)
  WHERE next_custom_reminder_at IS NOT NULL AND archived_at IS NULL;
