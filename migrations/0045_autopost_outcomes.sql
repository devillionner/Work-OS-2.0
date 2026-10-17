-- Автопост: скільки разів задачу вже пробували і чим вона закінчилась. Лише додаємо колонки й індекс.
-- attempts рахує спроби, що завершились тимчасовою помилкою: після третьої задача пропускається на сьогодні.
ALTER TABLE whatsapp_autopost_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
-- outcome заповнюється, коли задача закрита невдачею: archived, waiting, snoozed, skipped, needs_decision, resolved.
ALTER TABLE whatsapp_autopost_jobs ADD COLUMN outcome TEXT;

-- Чати, що чекають рішення власника, шукаються за цим індексом і не потрапляють у нові партії.
CREATE INDEX IF NOT EXISTS whatsapp_autopost_jobs_decision_idx
  ON whatsapp_autopost_jobs(user_id,chat_id)
  WHERE outcome='needs_decision';
