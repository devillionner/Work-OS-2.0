-- Business dates are independent from technical creation timestamps.
-- A response, booking, and lesson may legitimately belong to three different days.

ALTER TABLE leads ADD COLUMN response_date TEXT;
ALTER TABLE leads ADD COLUMN booking_date TEXT;
ALTER TABLE lessons ADD COLUMN booking_date TEXT;

UPDATE leads
SET response_date = CASE
  WHEN json_extract(legacy_payload_json, '$.createdDate') GLOB '??.??.??'
    THEN '20' || substr(json_extract(legacy_payload_json, '$.createdDate'), 7, 2)
      || '-' || substr(json_extract(legacy_payload_json, '$.createdDate'), 4, 2)
      || '-' || substr(json_extract(legacy_payload_json, '$.createdDate'), 1, 2)
  WHEN json_extract(legacy_payload_json, '$.createdDate') GLOB '??.??.????'
    THEN substr(json_extract(legacy_payload_json, '$.createdDate'), 7, 4)
      || '-' || substr(json_extract(legacy_payload_json, '$.createdDate'), 4, 2)
      || '-' || substr(json_extract(legacy_payload_json, '$.createdDate'), 1, 2)
  WHEN json_extract(legacy_payload_json, '$.createdDate') GLOB '????-??-??'
    THEN json_extract(legacy_payload_json, '$.createdDate')
  ELSE date(created_at, 'unixepoch')
END;

UPDATE leads
SET booking_date = CASE
  WHEN json_extract(legacy_payload_json, '$.bookedDate') GLOB '??.??.??'
    THEN '20' || substr(json_extract(legacy_payload_json, '$.bookedDate'), 7, 2)
      || '-' || substr(json_extract(legacy_payload_json, '$.bookedDate'), 4, 2)
      || '-' || substr(json_extract(legacy_payload_json, '$.bookedDate'), 1, 2)
  WHEN json_extract(legacy_payload_json, '$.bookedDate') GLOB '??.??.????'
    THEN substr(json_extract(legacy_payload_json, '$.bookedDate'), 7, 4)
      || '-' || substr(json_extract(legacy_payload_json, '$.bookedDate'), 4, 2)
      || '-' || substr(json_extract(legacy_payload_json, '$.bookedDate'), 1, 2)
  WHEN json_extract(legacy_payload_json, '$.bookedDate') GLOB '????-??-??'
    THEN json_extract(legacy_payload_json, '$.bookedDate')
  WHEN booked_at IS NOT NULL THEN date(booked_at, 'unixepoch')
  ELSE NULL
END;

UPDATE lessons
SET booking_date = COALESCE(
  (
    SELECT CASE
      WHEN COALESCE(json_extract(item.value, '$.bookingAccountingDate'), json_extract(item.value, '$.createdDate')) GLOB '??.??.??'
        THEN '20' || substr(COALESCE(json_extract(item.value, '$.bookingAccountingDate'), json_extract(item.value, '$.createdDate')), 7, 2)
          || '-' || substr(COALESCE(json_extract(item.value, '$.bookingAccountingDate'), json_extract(item.value, '$.createdDate')), 4, 2)
          || '-' || substr(COALESCE(json_extract(item.value, '$.bookingAccountingDate'), json_extract(item.value, '$.createdDate')), 1, 2)
      WHEN COALESCE(json_extract(item.value, '$.bookingAccountingDate'), json_extract(item.value, '$.createdDate')) GLOB '??.??.????'
        THEN substr(COALESCE(json_extract(item.value, '$.bookingAccountingDate'), json_extract(item.value, '$.createdDate')), 7, 4)
          || '-' || substr(COALESCE(json_extract(item.value, '$.bookingAccountingDate'), json_extract(item.value, '$.createdDate')), 4, 2)
          || '-' || substr(COALESCE(json_extract(item.value, '$.bookingAccountingDate'), json_extract(item.value, '$.createdDate')), 1, 2)
      WHEN COALESCE(json_extract(item.value, '$.bookingAccountingDate'), json_extract(item.value, '$.createdDate')) GLOB '????-??-??'
        THEN COALESCE(json_extract(item.value, '$.bookingAccountingDate'), json_extract(item.value, '$.createdDate'))
      ELSE NULL
    END
    FROM leads source_lead, json_each(source_lead.legacy_payload_json, '$.lessons') item
    WHERE source_lead.id = lessons.lead_id
      AND json_extract(item.value, '$.id') = lessons.legacy_id
    LIMIT 1
  ),
  (SELECT booking_date FROM leads WHERE leads.id = lessons.lead_id),
  date(created_at, 'unixepoch')
);

UPDATE activity_events
SET event_date = (SELECT response_date FROM leads WHERE leads.id = activity_events.lead_id),
    metadata_json = json_set(metadata_json, '$.responseDate', (SELECT response_date FROM leads WHERE leads.id = activity_events.lead_id))
WHERE event_type = 'lead_created' AND lead_id IS NOT NULL;

UPDATE activity_events
SET event_date = (SELECT booking_date FROM lessons WHERE lessons.id = activity_events.lesson_id),
    metadata_json = json_set(metadata_json, '$.bookingDate', (SELECT booking_date FROM lessons WHERE lessons.id = activity_events.lesson_id))
WHERE event_type = 'lesson_booked' AND lesson_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_user_response_date_idx ON leads(user_id, response_date);
CREATE INDEX IF NOT EXISTS leads_user_booking_date_idx ON leads(user_id, booking_date);
CREATE INDEX IF NOT EXISTS lessons_user_booking_date_idx ON lessons(user_id, booking_date);
