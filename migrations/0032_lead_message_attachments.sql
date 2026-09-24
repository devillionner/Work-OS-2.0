-- CRM conversation media stored in bounded D1 chunks.
-- Binary chunks are isolated from message rows so history pagination never reads file bodies.
CREATE TABLE lead_message_attachments (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  lead_id TEXT NOT NULL REFERENCES leads(id),
  message_id TEXT NOT NULL REFERENCES lead_messages(id),
  file_name TEXT NOT NULL CHECK(length(trim(file_name)) BETWEEN 1 AND 180),
  content_type TEXT NOT NULL CHECK(length(trim(content_type)) BETWEEN 1 AND 160),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 64),
  created_at INTEGER NOT NULL
);
CREATE INDEX lead_message_attachments_owner_message_idx
  ON lead_message_attachments(user_id,lead_id,message_id,created_at,id);

CREATE TABLE lead_message_attachment_chunks (
  id TEXT PRIMARY KEY NOT NULL,
  attachment_id TEXT NOT NULL REFERENCES lead_message_attachments(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  chunk_index INTEGER NOT NULL CHECK(chunk_index BETWEEN 0 AND 63),
  data_base64 TEXT NOT NULL CHECK(length(data_base64) BETWEEN 1 AND 350000),
  UNIQUE(attachment_id,chunk_index)
);
CREATE INDEX lead_message_attachment_chunks_owner_attachment_idx
  ON lead_message_attachment_chunks(user_id,attachment_id,chunk_index);

CREATE TRIGGER lead_message_attachments_cleanup AFTER UPDATE OF deleted_at ON lead_messages
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
 DELETE FROM lead_message_attachment_chunks
   WHERE attachment_id IN (SELECT id FROM lead_message_attachments WHERE message_id=NEW.id AND user_id=NEW.user_id);
 DELETE FROM lead_message_attachments WHERE message_id=NEW.id AND user_id=NEW.user_id;
END;

CREATE TRIGGER backup_revision_lead_message_attachments_insert AFTER INSERT ON lead_message_attachments
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lead_message_attachments_update AFTER UPDATE ON lead_message_attachments
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lead_message_attachments_delete AFTER DELETE ON lead_message_attachments
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lead_message_attachment_chunks_insert AFTER INSERT ON lead_message_attachment_chunks
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lead_message_attachment_chunks_update AFTER UPDATE ON lead_message_attachment_chunks
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lead_message_attachment_chunks_delete AFTER DELETE ON lead_message_attachment_chunks
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
