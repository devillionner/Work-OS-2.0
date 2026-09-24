CREATE TABLE IF NOT EXISTS curator_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  legacy_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  submitted_at INTEGER NOT NULL,
  submitted_date TEXT NOT NULL,
  resolved_at INTEGER,
  lesson_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source_import_id TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE SET NULL,
  FOREIGN KEY (source_import_id) REFERENCES legacy_imports(id) ON DELETE SET NULL,
  UNIQUE (lead_id, legacy_id)
);

CREATE INDEX IF NOT EXISTS curator_requests_user_status_date_idx
  ON curator_requests(user_id, status, submitted_date);
CREATE INDEX IF NOT EXISTS curator_requests_lead_idx
  ON curator_requests(lead_id, submitted_at DESC);

INSERT OR IGNORE INTO curator_requests (
  id,user_id,lead_id,legacy_id,status,submitted_at,submitted_date,resolved_at,
  lesson_id,created_at,updated_at,source_import_id
)
SELECT
  'curator_' || lower(hex(randomblob(16))),
  lead.user_id,
  lead.id,
  json_extract(item.value, '$.id'),
  CASE json_extract(item.value, '$.status')
    WHEN 'pending' THEN 'pending'
    WHEN 'confirmed' THEN 'confirmed'
    ELSE 'cancelled'
  END,
  COALESCE(CAST(json_extract(item.value, '$.submittedAt') AS INTEGER) / 1000, lead.created_at),
  CASE
    WHEN json_extract(item.value, '$.submittedDate') GLOB '??.??.??'
      THEN '20' || substr(json_extract(item.value, '$.submittedDate'), 7, 2)
        || '-' || substr(json_extract(item.value, '$.submittedDate'), 4, 2)
        || '-' || substr(json_extract(item.value, '$.submittedDate'), 1, 2)
    WHEN json_extract(item.value, '$.submittedDate') GLOB '????-??-??'
      THEN json_extract(item.value, '$.submittedDate')
    ELSE date(lead.created_at, 'unixepoch')
  END,
  CASE WHEN json_extract(item.value, '$.resolvedAt') IS NULL THEN NULL
    ELSE CAST(json_extract(item.value, '$.resolvedAt') AS INTEGER) / 1000 END,
  lesson.id,
  COALESCE(CAST(json_extract(item.value, '$.submittedAt') AS INTEGER) / 1000, lead.created_at),
  COALESCE(CAST(json_extract(item.value, '$.resolvedAt') AS INTEGER) / 1000,
    CAST(json_extract(item.value, '$.submittedAt') AS INTEGER) / 1000, lead.updated_at),
  lead.source_import_id
FROM leads lead
JOIN json_each(lead.legacy_payload_json, '$.curatorRequests') item
LEFT JOIN lessons lesson
  ON lesson.lead_id = lead.id AND lesson.legacy_id = json_extract(item.value, '$.lessonId');

INSERT OR IGNORE INTO activity_events (
  id,user_id,event_type,platform,chat_id,lead_id,lesson_id,occurred_at,event_date,
  metadata_json,source_key,source_import_id
)
SELECT
  'event_' || lower(hex(randomblob(16))), request.user_id, 'curator_booking_pending',
  lead.platform, lead.source_chat_id, request.lead_id, NULL, request.submitted_at,
  request.submitted_date,
  json_object('curatorRequestId', request.id, 'status', request.status),
  'legacy:curator-request:' || request.legacy_id,
  request.source_import_id
FROM curator_requests request
JOIN leads lead ON lead.id = request.lead_id
WHERE request.status = 'pending';
