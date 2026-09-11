# Development status — 2026-09-11

Canonical product scope: [PRODUCT_REQUIREMENTS](PRODUCT_REQUIREMENTS.md).
Next work and acceptance gates: [ROADMAP](ROADMAP.md).

## Current working policy

- Direct main, small verified commits, local lint/tests/build before push.
- Prototype Checker/GitHub read-only; no daily resync. Final transfer only after
  functional parity and direct confirmation. No production D1 cleanup/deletion.
- All tests, migration rehearsals and restore drills local. CI does not deploy.
- Manual usability precedes AI/generation/autoposting.

## Release visibility

- The sidebar shows the current Work OS version and opens a short Ukrainian change
  list without a network request or D1 read. The notes cover the latest manual
  workflow work; keeping the version and release date aligned with package releases
  remains a small maintainer task. Full desktop/mobile visual acceptance is open.

## Today refresh after manual work

- Returning to «Сьогодні» from another workspace now calls an explicit server
  refresh, so platform, lead, report and goal counters do not stay stale after a
  completed manual action. This is navigation-triggered only; background polling
  and cross-tab synchronization remain intentionally out of scope.
- Cloudflare Workers Builds triggers checked read-only on 2026-09-10: both
  work-os-2 and work-os-2-staging returned no triggers. No D1 reads/writes used.

## Current iteration: manual bulk chat addition

- Added an authenticated same-origin API and a posting-workspace dialog for up to
  500 mixed Telegram/WhatsApp/Viber/Facebook links. Preview identifies new,
  existing, archived, repeated and invalid rows, with platform counts. Users can
  rename new chats, remove rows and return to the edited list before saving.
- The server rechecks ownership, normalized legacy URLs and the preview revision.
  All new rows and one audit receipt commit together. Concurrent writes, failed
  receipts and an unknown transport outcome cannot create a partial batch or
  duplicate chats. Existing states/names remain intact; new chats enter to_join
  and Telegram starts in the common unassigned pool. No join/publication metric
  is produced by adding a list or by state-change-only audit events.
- Preview uses two SQL statements and add uses five for 1–500 rows. Legacy aliases
  currently require one owner/platform-scoped scan, bounded at 10k existing chats.
  A larger matching database is refused with a clear message. Canonical indexed
  keys/backfill remain P4 work. Local 10k preview measured 169 ms alone / 336 ms
  during the parallel suite; these are observations, not a production p95 claim.
- Browser QA used the real dialog and handler with an in-memory local D1 harness:
  mixed preview, archive/duplicate/invalid counts, edited name, row removal,
  lost response after commit, close/reopen/retry, success and a 500-row save.
  Desktop 1280×720 and narrow 390×844 layouts checked. Fixed a transparent popup
  background, kept save controls below the scrollable list, and expanded phone
  touch targets. This does not substitute for Safari/iPhone or whole-workspace QA.
- Workspace shows an eight-second summary, opens a matching enabled platform's
  to_join queue, resets search/pagination and refreshes. Old rows are hidden as
  soon as the requested list changes. Full integration acceptance remains open.
- No remote name lookup, CSV import, existing-chat name editor or migration added.
  Prototype was read only as a parser reference; no remote D1 work or deploy.
- `npm run verify` passed: lint, 87/87 local tests and build, including 11 bulk-add,
  3 profile-editor, 2 history, 2 publication-attribution and 1 available-links
  regression. Linux CI is
  checked after push. No production deployment.

## Chat history surface

- Added an on-demand, owner-scoped history endpoint and dialog. It reads up to 50
  newest chat events with Kyiv-local timestamps and Ukrainian labels for state
  transitions, joins, publications and profile changes. The read path is strictly
  read-only and does not alter backup revisions or business totals.
- The workspace exposes «Історія» on each chat row. Publication language is shown
  next to the linked material; older imported event rendering and full
  workspace/Safari acceptance remain open.

## Lead history surface

- The lead card now opens an on-demand owner-scoped history with the latest contact,
  booking, lesson, reminder and curator events, including cancellation and reason
  metadata. Each lesson also has its own bounded read-only history view; full
  workspace/mobile acceptance remains open.

## Report date navigation

- The report calendar now makes future dates visibly unavailable and the API rejects
  them as well. «Сьогодні» returns to the Kyiv-local current date, and Alt+← / Alt+→
  moves between available days while preserving the selected month. The controls do
  not add polling or D1 writes; report version/history and full desktop/mobile QA
  remain open.

## Report version history

- Migration 0020 records each created or edited report as a bounded owner-scoped
  `report_revision` activity event. The report workspace opens the selected date’s
  versions on demand and keeps the latest text expanded for review. History is
  excluded from business totals; restore/version comparison and full mobile QA
  remain open.

## Report event details

- Selecting a report date now shows bounded owner-scoped lists of active responses
  and bookings with lead name, platform and subject. «Відкрити» moves to the lead
  card; cancelled and foreign-owner events are excluded, and the read path is
  covered locally without writes. Full field reconciliation and mobile acceptance
  remain open.

## Manual publication attribution

- The ready-chat action opens a manual preparation dialog. It loads the owner’s active
  advertisement library, supports search, language choice, text copy and a platform
  deep link, then records the publication only after the user confirms the manual fact.
- The server stores `advertisement_id` and the effective language (`uk`/`ru`) in an
  audit metadata key atomically with the publication event. Foreign, archived or
  script items are rejected by the same D1 transaction; a publication without a
  selected library item remains available.
- Chat history resolves the selected title without exposing another owner’s library.
  Automatic profile-based selection, no-repeat planning and scheduler remain open.

## Return-from-chat continuity

- Opening a native platform link now records the current queue, search, page, scroll
  position and chat ID in per-platform session storage. Returning to the workspace
  restores the saved view and gives the last opened row a quiet highlight.
- The same record path is used by the profile and publication dialogs. Invalid or
  oversized stored values are ignored safely; this is browser-session state only and
  does not write D1. Safari/iPhone and full workspace acceptance remain open.

## Available publication links

- The ready queue now includes a bounded «Доступні зараз» block with copyable links.
  It excludes chats already published today, snoozed chats and Telegram chats that
  have not passed the six-hour wait, while preserving the selected account scope.
- The extra query runs only for the ready queue and is capped at 200 rows. The local
  D1 regression covers published, snoozed, foreign-owner and other-account rows.

## Profile review filter

- Waiting and ready queues can be narrowed to chats whose profile is missing or not
  confirmed. The filter is owner-scoped in the API and keeps the urgent manual path
  available instead of hiding or blocking those chats.
- The publication dialog now states clearly when profile rules are not confirmed;
  the queue also shows confirmed, draft and missing-profile counters from the same
  owner/account-scoped counts statement. Automatic cadence/direction selection and
  full workspace/Safari acceptance remain open.

## Profile editor follow-up

- Added a manual profile form to waiting/ready chat rows. It edits the chat name,
  language, cadence, allowed weekdays, directions, note and reviewed/draft state,
  and offers the platform deep link from the same form. The GET response includes
  existing profile data so confirmed profiles reopen with their saved values.
- Profile save updates the chat and profile together, writes one audit event and
  advances the displayed state token. A stale token, foreign owner or failed audit
  write leaves both tables unchanged. Profile audit events are excluded from
  business totals and report pending-after-submit counts.
- Three local Miniflare tests cover validation, create/update, owner/version guards
  and rollback. The form was visually checked with a local browser harness on the
  saved-value path. Full platform-workspace and Safari/iPhone acceptance remains
  open; custom intervals, automatic selection and publication scheduling are not
  implemented.

## Safe chat undo

- Archive, failed-join and snooze actions now return the post-action state token.
  The workspace offers an eight-second «Скасувати» action and sends that token back
  for the inverse restore/unsnooze operation, so a concurrent change is rejected
  instead of being overwritten. No polling or remote D1 test is added; bulk undo
  remains open.

## Archive reason entry

- Archive choices retain the three common reasons and now accept a custom note up
  to 100 characters. The note uses the same guarded archive action and remains
  visible in the archived row and chat history.

## Previous iteration: guarded chat transitions

- All manual chat actions carry the displayed state token. Writes recheck it in
  the D1 transaction, including same-second archive/restore and snooze/resume
  cycles. Conflicts refresh the list without replaying the rejected action.
- Joining, waiting, approval, failure, archive, restore, WhatsApp return and
  Telegram reassignment now share a tested transition module. Approval starts
  the six-hour Telegram wait at the actual confirmation time.
- A successful state change adds an audit event atomically. Failed writes or
  stale actions add no history, metric or Telegram streak increment. Daily join
  metrics stay unique even when the existing event came from a legacy snapshot.
- Publication also checks the displayed version and an enabled, owned Telegram
  account. Reassignment preserves archive details and historical attribution.
- The joined-today link list reads events and survives archive/restore/account
  changes. State-token reads use the existing chat event index and never write.
- Client writes are serialized; superseded list requests are aborted/ignored.
  Failed loads clear old rows and offer an explicit retry. Telegram join counters
  refresh after a successful chat action.
- No SQL migration, remote D1 test, restore drill, deploy or Prototype change.
  New API requires stateToken; existing browser tabs need a page reload at release.
- `npm run verify` passed: lint, 68/68 local tests and build, including 13 new
  transition/client-gate regressions. Linux CI passed for 1ef3ac4:
  [run 34510363437](https://github.com/devillionner/Work-OS-2.0/actions/runs/34510363437).
  Desktop/iPhone visual acceptance, a user-facing transition history and server
  guards for concurrent Telegram account-management actions remain open.

## Previous iteration: calendar snooze and event totals

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
  D1 data). Linux CI passed for 3223d29: [run 34508259431](https://github.com/devillionner/Work-OS-2.0/actions/runs/34508259431).
- Remaining at the end of that iteration: visual desktop/iPhone QA, guards for the other chat transitions,
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
  summary for the selected day and revision intensity (migrations 0016, 0020).
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

Follow P1 in [ROADMAP](ROADMAP.md): whole-workspace/Safari acceptance, existing chat
profiles/names, visible transition history, account-scoped Telegram scheduling and
safe undo. Manual library attribution and return-from-chat continuity are now in place.
Then complete Today/CRM/report parity.

The older PR #6 review and cutover file are historical evidence, not commands to
repeat remote migration/restore checks. Production release and final transfer are
separate gates after local validation and the required direct confirmation.
