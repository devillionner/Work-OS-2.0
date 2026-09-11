CREATE TRIGGER IF NOT EXISTS daily_reports_revision_insert
AFTER INSERT ON daily_reports
BEGIN
  INSERT OR IGNORE INTO activity_events (
    id,user_id,event_type,occurred_at,event_date,metadata_json,source_key
  ) VALUES (
    'report_revision:' || NEW.id || ':' || COALESCE(NEW.revision_count,1),
    NEW.user_id,
    'report_revision',
    NEW.updated_at,
    NEW.report_date,
    json_object(
      'reportId',NEW.id,
      'revision',COALESCE(NEW.revision_count,1),
      'text',NEW.report_text,
      'submittedAt',NEW.submitted_at,
      'source',CASE WHEN NEW.source_import_id IS NULL THEN 'manual' ELSE 'import' END
    ),
    'report_revision:' || NEW.id || ':' || COALESCE(NEW.revision_count,1)
  );
END;

CREATE TRIGGER IF NOT EXISTS daily_reports_revision_update
AFTER UPDATE OF report_text,submitted_at ON daily_reports
WHEN NEW.revision_count > OLD.revision_count
  AND (OLD.report_text IS NOT NEW.report_text OR OLD.submitted_at IS NOT NEW.submitted_at)
BEGIN
  INSERT OR IGNORE INTO activity_events (
    id,user_id,event_type,occurred_at,event_date,metadata_json,source_key
  ) VALUES (
    'report_revision:' || NEW.id || ':' || NEW.revision_count,
    NEW.user_id,
    'report_revision',
    NEW.updated_at,
    NEW.report_date,
    json_object(
      'reportId',NEW.id,
      'revision',NEW.revision_count,
      'text',NEW.report_text,
      'submittedAt',NEW.submitted_at,
      'source',CASE WHEN NEW.source_import_id IS NULL THEN 'manual' ELSE 'import' END
    ),
    'report_revision:' || NEW.id || ':' || NEW.revision_count
  );
END;
