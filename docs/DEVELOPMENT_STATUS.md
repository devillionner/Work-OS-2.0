# Development status — 2026-09-10

Canonical product scope: [PRODUCT_REQUIREMENTS](PRODUCT_REQUIREMENTS.md).
Next work and acceptance gates: [ROADMAP](ROADMAP.md).

## Current working policy

- Direct main, small verified commits, local lint/tests/build before push.
- Prototype Checker/GitHub read-only; no daily resync. Final transfer only after
  functional parity and direct confirmation. No production D1 cleanup/deletion.
- All tests, migration rehearsals and restore drills local. CI does not deploy.
- Manual usability precedes AI/generation/autoposting.
- Cloudflare Workers Builds triggers checked read-only on 2026-09-10: both
  work-os-2 and work-os-2-staging returned no triggers. No D1 reads/writes used.

## Current iteration: calendar snooze and event totals

- Snooze ends at Kyiv midnight three calendar dates later, including DST, leap
  days and year boundaries. Waiting/ready queues offer an explicit resume action.
- Publication checks the live chat state, snooze and Telegram six-hour wait inside
  the D1 transaction. Duplicate clicks create one publication and one event;
  failure to save the event rolls back the publication. No schema change needed.
- Today, report summary and event analytics share activity_events aggregation.
  Report text never changes counters. Repeat bookings, curator pending bookings,
  Threads, archived leads and cancelled events are handled consistently. Hidden
  platforms still contribute to the daily goal; a configured zero goal is retained.
- Report date selection sends one request; abort/request guards ignore old results.
  Loading prevents saving the previous day's text under a newly selected date.
  The report workspace is now included in the normal lint command.
- Local lint, 55/55 tests and build passed (nine new tests use synthetic in-memory
  D1 data). Current Linux CI is checked after push. Browser/iPhone QA is still pending.
- Remaining: visual desktop/iPhone QA, guards for the other chat transitions,
  cross-module Today refresh, report correction/source UI and version-based report
  staleness. Timestamp comparison does not detect changes within the same second
  or an event moved out of the report's business date.
- No remote D1 operation, migration, restore drill or deploy performed.

## Previous iteration: requirements and local development

- Canonical register: 253 legacy IDs plus 23 explicit additions, each with status,
  source/evidence and gaps; stack/report/migration/schedule conflicts reconciled.
- Roadmap P0–P6, local-only runbook, data policy and design contract.
- npm run verify + local CI; remote migration requires reason/explicit flag and
  is blocked in CI. Unknown migration-log results fail closed.
- Local Vite bindings explicitly disable remote connections.
- Timer GET is read-only; completion derives from persisted ends_at. Polling is
  bounded to 120 seconds in a visible online tab; errors/slow requests cannot
  create one-second request loops. Stale reads cannot replace local mutations.
- Today opens manual posting/leads/reports; no daily import/backup task prompt.
- Library Add opens an empty editor; successful create keeps the returned ID so
  saving again edits the same material. Visual/mobile QA remains unverified.

## Validation for the previous iteration

- Local lint passed; 46/46 tests passed including D1 read-only timer projection,
  owner isolation, refresh rate/error/overlap and remote-migration refusal.
- `npm run verify`: passed on 2026-09-10 (lint, 46/46 tests, build). Build used the
  default staging configuration with remote bindings disabled. No deploy performed.
- Register audit: 253/253 source IDs retained, 276 total, no duplicate IDs, invalid
  statuses or broken source/code links. Prototype working tree remains clean.
- Linux CI passed for 152173a: [run 34476237149](https://github.com/devillionner/Work-OS-2.0/actions/runs/34476237149).
  This does not claim production deployment or completed browser/mobile QA.


## Done

- Leads CRUD through create/read/edit/archive/restore; five platforms, normalized
  duplicate detection (including archived contacts), subject/contact/source/note.
- Several students per lead, grade 1–11 or null, age category and notes.
- Several lessons per lead; repeat booking, linked rescheduling, lifecycle status
  and reasons; independent response/booking/lesson dates.
- Two independent configurable reminders, defaults 1440/60 minutes, manual
  sent/skipped, needs-data, reset markers and retain settings on reschedule.
- Follow-up and paginated overdue query for future Today; A/B/C lead/family
  qualification, duplicate state, funnel, explicit first reply and derived waiting.
- Internal lead/me messages with timestamp, edit, soft delete and `.txt` export.
- Shared design primitives, responsive list/detail, semantic labels, focus states,
  confirmation dialogs; distinct lesson, follow-up and conversation blocks.
- Server validation/auth boundary, D1/Drizzle repository, atomic command/event
  batches, optimistic concurrency, idempotency receipts and event-based metrics.
- Additive `0014_leads_domain.sql`; no production data deleted or remotely changed.
- Repeat-import guards for incoming/persisted parents; consistent cloud backup schema 5.
- PR #6 hardening: additive migration 0015, restorable receipts, curator cancellation/
  race guard, stale-form and retry protection, unknown-date preservation, expired
  reminders, Kyiv timezone database offsets and Ukrainian name search.
- Read-only Analytics workspace: selectable 7/30/90-day window, event-derived funnel,
  platform comparison and per-chat publication/response/booking conversion table.
- Reports workspace: month calendar, day selection, report editing/creation, event
  summary for the selected day and revision intensity (migration 0016).
- Library workspace: searchable advertisements and scripts with separate Ukrainian
  and Russian versions, notes/tags/platforms, archive action and schema-5 backup
  coverage (migration 0017).
- Today focus controls: persisted daily/monthly booking goals and grouped focus
  directions (including Logopediya/defectology and IT/chess) with a real settings
  dialog and owner-scoped settings API.
- Settings workspace: cloud backup action, account visibility, and owner-scoped
  active-platform toggles. Disabled platforms are hidden from the posting picker
  without deleting chats, events, or historical analytics.
- Cloud backup restore preview: local and server-side schema/count/ownership/key/
  relationship validation, read-only comparison with the current D1 revision and
  backward compatibility for schema-5 backups created before the library module.
- Cloud restore staging: validated backups are stored outside working tables in
  bounded, per-table chunks with SHA-256 checksums; staging survives reloads and
  records both the source revision and current D1 revision without applying data.
- Missing-only restore: requires a fresh post-staging backup at the current D1
  revision, explicit consent, checksum verification for every chunk and resumable
  jobs. Existing rows are never overwritten, absent-source rows are never deleted,
  and cross-owner ID collisions stop the job before a write.

## Validation

- `npm run lint`: passed (includes all new Leads components).
- `npm run build`: passed; `/api/leads` included in production route output.
- `npm test`: passed (six test files/suites covering the hardened Leads domain).
  Covers duplicates, several students/lessons, retry/concurrency, reschedule,
  reminders, first reply, overdue, archive/restore, events/historical metrics,
  message export, ownership, request validation and DST.
- Migration test uses a **synthetic** 24/5/9 fixture plus a historical event;
  it is not a production database inspection or reconciliation.
- Authenticated browser QA passed on the reachable staging preview for Today,
  Platforms and Leads on desktop/mobile, including navigation, Telegram account
  selection, queue/search behavior and lead detail loading. Analytics still needs
  a focused visual pass after this change.

## Partial / deliberate limits

- Reminder messages are copied and sent manually; there is no scheduler or
  Telegram/WhatsApp integration. This is the requested scope.
- Imported fields with unknown business times remain unknown; complete them in CRM.
- Repeat imports stop on a managed lead conflict. A reviewed conflict comparison/
  resolution UI is not part of this Leads implementation.
- Permanent lead deletion is intentionally absent; archive is the normal delete
  operation. Internal message deletion is soft and excluded from `.txt` exports.
- New curator-request creation remains outside scope. Booking confirms a selected
  existing pending request and cancels its provisional event atomically, avoiding
  double-counting alongside the real booking. Existing pending requests can also
  be cancelled with a reason, preserving their historical events.
- Restore apply deliberately supports only recovery of missing rows. Reverting
  existing row values to an older snapshot remains unavailable because that would
  be destructive and needs a separate exact-restore design and rehearsal.

## Next

Follow P1 in [ROADMAP](ROADMAP.md): guards for remaining chat transitions, local UI
acceptance, bulk chat addition/profiles/library attribution and account-scoped
Telegram scheduling. Then complete Today/CRM/report parity.

The older PR #6 review and cutover file are historical evidence, not commands to
repeat remote migration/restore checks. Production release and final transfer are
separate gates after local validation and the required direct confirmation.
