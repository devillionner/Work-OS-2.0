# PR #6 hardening review — 2026-09-08

Reviewed the required README/architecture/migration/cutover/status documents and
all 35 files in the original PR diff, including the SQL migration, API/import/backup
changes, domain/application/data layers, React components, styles and tests. Reviewed
authentication and dashboard event queries as adjacent integration boundaries.
No production database was inspected or changed. No merge or deployment performed.

## Critical / correctness findings fixed

- **Stale forms could use a newer aggregate version.** Uncontrolled forms now keep
  the save callback/version from when they opened. In-flight dialogs cannot be
  dismissed. Aborted fetch results cannot replace the selected detail, and an old
  GET cannot downgrade a newer loaded version. Selecting details moves focus there.
- **Uncertain delivery could become a second booking.** Transport retains the exact
  command ID/body, including through an account-scoped session reload. If the next
  form changed, it resolves the previous command before permitting a new action.
  The server rechecks receipts when a concurrent retry wins between receipt lookup
  and aggregate load. Retryable auth/transport responses retain the delivery intent.
- **Repeat sync guarded only the incoming lead.** The importer now also guards the
  persisted parent matched by ID, legacy unique key or event source key. Guards,
  upserts and job cursor remain one atomic batch; a conflict rolls the chunk back.
- **Backup was not consistently restorable.** Historical command receipts failed
  the live version trigger; legacy provenance parents were absent; pages could mix
  different database states. Migration 0015 separates CAS assertions from receipts.
  Schema 5 exports provenance/chunks and uses per-owner revision checks plus counts.
  A real local D1 round-trip test compares every exported row/column and checks FKs.
- **A known response date could be cleared via direct API**, leaving its metric
  unchanged. Clearing known business dates is rejected. Existing unknown dates stay
  null during unrelated edits/reschedule; forms do not silently fill today's date.
  Date corrections update the canonical event date and its metadata together.
- **Incomplete imported lessons could not acquire a missing time**, and edits could
  replace their student name with the contact name. Completing missing time is now
  a data correction; changing an existing time still requires a linked reschedule.
- **Old booked lessons still offered sendable reminders.** Past starts now produce
  `expired` with no text; marking sent is rejected while skipping remains available.
- **Curator status could change after application validation.** The same atomic CAS
  guard checks pending state before any booking commits. Existing pending requests
  can be cancelled with a reason; only their provisional event is cancelled.

## Architecture and additional hardening

- `/api/leads` remains a small auth/HTTP adapter; React has presentation/form state,
  not D1 access or lifecycle/event writes. Business-date correction decisions moved
  out of the repository into explicit application changesets.
- Backup SQL and legacy import assertions have small data-layer modules. Transport
  and timestamp form adapters live in `lib/leads/client`, outside React components.
- Removed quadratic reminder/replacement lookups. Aggregate loads use a fixed batch,
  not one query per lesson. Added owner/archive/update and event/receipt indexes.
  Duplicate candidate reads include legacy fallback while narrowing native contacts.
- Strict JSON media-type checking and bounded canonicalization depth; malformed
  plus placement in phone numbers rejected. Same-origin, authenticated ownership,
  field allowlists, grade/subject validation and non-http URL rejection retained.
- Ukrainian/Russian name case folding addresses SQLite's ASCII-only `lower()`.
- Kyiv offsets are derived from runtime timezone data. Nonexistent/ambiguous wall
  times remain rejected; unchanged minute-precision inputs preserve exact seconds.
- `0014_leads_domain.sql` is unchanged. `0015` adds guards/indexes/backup revision
  tracking and replaces the receipt trigger without deleting business rows.

## Regression coverage and results

`npm run lint`, `npm run build`, `npm test`: passed; **33/33 tests**.
15 hardening scenarios supplement the original 18 tests: uncertain transport,
reload journal, timestamp precision/DST, date clearing/metadata, incomplete imported
lessons, expired reminders, racing identical retry, persisted-parent sync conflict,
paged backup revision/owner isolation, exact backup restoration, Ukrainian search,
curator race/cancellation, strict media type and unknown imported business dates.

Existing tests still cover normalized phone/Telegram duplicates, multiple students
and lessons, repeat booking, linked reschedule with one booking metric, reminder
settings/defaults/reset/needs-data, first reply immutability, overdue follow-up,
archive/restore with historical events, owner isolation, hostile payloads, soft
message deletion and text export. D1 tests inject failures both before and after
aggregate changes, proving rollback of records/events/receipts. The migration fixture
has synthetic 24 leads / 5 students / 9 lessons, not the real production dataset.

## Backup restore contract

The round-trip regression uses a fresh database with migrations through 0015 and
the same owner ID seeded. Export includes all columns and provenance parents/chunks;
it excludes authentication sessions, operational migration jobs and backup audits.
Restore is an operator procedure, not a public overwrite endpoint or new UI module:

1. Validate the file, expected owner, table/count inventory and schema version; retain
   the original file and its SHA-256. Use only an empty isolated staging database.
2. Seed the matching owner. Use table/column allowlists and bound values. Defer FK
   checks inside the restore transaction so UUID order cannot break lesson chains.
3. Insert lead snapshots with `managed_at = NULL`, then restore their exact original
   `managed_at` values after rows are present. This avoids live duplicate-entry
   policy rejecting a valid historical duplicate set; never use this on live data.
4. Restore all listed tables, including soft-deleted messages and command receipts.
   Do not restore ephemeral guards or technical revision values; triggers rebuild
   revision tracking. Assert every table/column against the file and run FK checks.
5. Replay an original booking receipt and confirm no extra lesson/event is created.

This procedure is exercised by the local test; a production-sized operator restore
drill is still required. Old schema-4 files lack provenance parents/revision checks
and need the retained original D1/Prototype backup; do not label them schema 5.

## Remaining risks and release decision

- **Staging gate outstanding:** apply 0014 + 0015 on a real-data staging copy and
  reconcile counts, nullable/legacy fields and event metrics before/after, including
  reschedule/archive. Test repeat legacy conflict rollback and backup restoration.
- **UI gate outstanding:** authenticated desktop, narrow mobile and keyboard smoke
  QA in a reachable preview. The available browser previously blocked the local
  preview URL; visual QA is not claimed. Include dialog focus/escape, save/errors,
  stale-form recovery, reload after an uncertain response, double-click protection,
  long names/URLs and follow-up/reminder/curator controls.
- Full lead detail currently loads its entire internal history. Query count is
  bounded, but payload size grows with history; measure on staging and introduce
  history pagination before very large CRM conversations become common.
- A session journal is delivery recovery, not offline CRM. If session storage is
  unavailable, writes stop before transmission. Closing/clearing the browser session
  loses that recovery intent; inspect cloud history before manually repeating an
  uncertain booking from another session. No automatic external reminder delivery.
- Legacy sync is chunked, not whole-import atomic. A blocked later chunk leaves
  earlier committed chunks intact and stops explicitly. Conflict reconciliation is
  manual; do not blindly restart an import against managed aggregates.
- Drizzle maps this domain, not the entire database. SQL migrations are authoritative;
  do not run `drizzle-kit push` against the existing database.

**Ready for staging validation: yes. Ready for merge: no, pending the staging and
UI gates. Keep PR #6 draft.** No Today/Reports/Analytics/Library work was started.
