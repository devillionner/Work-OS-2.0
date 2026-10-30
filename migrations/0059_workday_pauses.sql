-- Журнал пауз робочого дня (2026-10-30). Раніше в workdays були лише paused_at (поточна пауза) і active_seconds, тож шкала «Сьогодні»
-- не знала, де стояли раніші паузи. Тепер кожна пауза — рядок (початок, кінець; кінець порожній, поки пауза триває). Пишуть його наявні
-- дії «Пауза» / «Продовжити» / «Завершити» у тому ж batch, що й сам workdays.
CREATE TABLE workday_pauses (
  id TEXT PRIMARY KEY NOT NULL,
  workday_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  FOREIGN KEY (workday_id) REFERENCES workdays(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX workday_pauses_workday_idx ON workday_pauses(workday_id, started_at);

CREATE TRIGGER backup_revision_workday_pauses_insert AFTER INSERT ON workday_pauses
BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER backup_revision_workday_pauses_update AFTER UPDATE ON workday_pauses
BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER backup_revision_workday_pauses_delete AFTER DELETE ON workday_pauses
BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

-- День, що зараз на паузі, має відкриту паузу з моменту paused_at; раніші паузи й паузи завершених днів невідомі (лишається «пауз раніше N хв»).
INSERT INTO workday_pauses(id,workday_id,user_id,started_at,ended_at)
SELECT 'wp_'||id,id,user_id,paused_at,NULL FROM workdays WHERE status='paused' AND paused_at IS NOT NULL;
