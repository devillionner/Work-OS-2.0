UPDATE chats
SET workflow_status = 'archived',
    archive_reason = COALESCE(archive_reason, 'Не вдалося приєднатися'),
    archived_at = COALESCE(archived_at, processed_at, updated_at)
WHERE workflow_status = 'failed';
