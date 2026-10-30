-- Учні з предметами (2026-10-30). Модель: 1 лід = 1 відгук (подія lead_created, лічильники відгуків і записів не змінюються);
-- leads.subject — «Звернувся з предмета»; запис = урок, предмет запису = предмет уроку. Учень — сам лід, якщо навчається
-- (students.kind='self'), і/або діти (kind='child'); у кожного учня предмети в student_subjects. Рівня поки немає.
ALTER TABLE students ADD COLUMN kind TEXT NOT NULL DEFAULT 'child' CHECK (kind IN ('child','self'));

CREATE TABLE student_subjects (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  UNIQUE (student_id, subject)
);
CREATE INDEX student_subjects_lead_idx ON student_subjects(user_id, lead_id);
CREATE INDEX student_subjects_student_idx ON student_subjects(student_id);

CREATE TRIGGER backup_revision_student_subjects_insert AFTER INSERT ON student_subjects
BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER backup_revision_student_subjects_update AFTER UPDATE ON student_subjects
BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER backup_revision_student_subjects_delete AFTER DELETE ON student_subjects
BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

-- Перенесення. Лід без учнів: сам лід стає учнем (kind='self'), якщо він навчається (is_student) або має предмет відгуку.
-- Старі події й уроки не чіпаємо.
INSERT INTO students(id,user_id,lead_id,legacy_id,name,surname,age_group,note,created_at,updated_at,grade,kind)
SELECT 'self_'||l.id,l.user_id,l.id,NULL,l.name,'',l.age_group,'',l.created_at,l.updated_at,NULL,'self'
FROM leads l
WHERE NOT EXISTS(SELECT 1 FROM students s WHERE s.user_id=l.user_id AND s.lead_id=l.id)
  AND (l.is_student=1 OR l.subject<>'');

-- Предмет відгуку переходить першому учню ліда (з дітьми це перша дитина, без дітей це сам лід).
INSERT OR IGNORE INTO student_subjects(id,user_id,lead_id,student_id,subject,created_at)
SELECT 'ss_'||s.id||'_lead',s.user_id,s.lead_id,s.id,l.subject,l.created_at
FROM students s JOIN leads l ON l.id=s.lead_id AND l.user_id=s.user_id
WHERE l.subject<>''
  AND s.id=(SELECT s2.id FROM students s2 WHERE s2.user_id=s.user_id AND s2.lead_id=s.lead_id ORDER BY s2.created_at,s2.id LIMIT 1);

-- Предмети наявних уроків: учень, якому призначено урок, має його предмет (урок без учня належить учневі self).
INSERT OR IGNORE INTO student_subjects(id,user_id,lead_id,student_id,subject,created_at)
SELECT 'ss_'||x.student_id||'_'||lower(hex(x.subject)),x.user_id,x.lead_id,x.student_id,x.subject,x.created_at
FROM (
  SELECT lo.user_id,lo.lead_id,COALESCE(lo.student_id,(SELECT s.id FROM students s WHERE s.user_id=lo.user_id AND s.lead_id=lo.lead_id AND s.kind='self' LIMIT 1)) AS student_id,
         lo.subject,MIN(lo.created_at) AS created_at
  FROM lessons lo WHERE lo.subject<>'' GROUP BY 1,2,3,4
) x WHERE x.student_id IS NOT NULL;
