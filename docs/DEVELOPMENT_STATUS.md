# Development status — 2026-09-09

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
- Restore preview is deliberately read-only. Applying a backup still requires a
  separately reviewed staging/import job; the UI cannot overwrite D1 directly.

## Next — staging and product gate

1. Review the PR and take a full current D1 backup; retain the original immutable
   Prototype backup referenced in `CUTOVER-2026-09-04.md`.
2. Apply migrations 0014 and 0015 on an isolated staging copy with matching code.
   Production release remains a separate, explicitly authorized operation; this
   review neither deploys nor runs production migrations.
3. Smoke-test authenticated create/edit, two students, repeated booking,
   reschedule, reminders, follow-up, message export and archive/restore on desktop
   and mobile, including keyboard focus and stale-version recovery.
4. Reconcile real production entity counts and historical metrics before/after;
   export schema-5 cloud backup and rehearse restoration in an empty staging DB,
   comparing every field and checking foreign keys (see `LEADS_PR6_REVIEW.md`).
5. Keep Prototype Checker available until these operational checks pass.
6. Run the focused Analytics, Reports and Library browser pass and reconcile their
   numbers/materials against the restored staging backup.

The PR #6 hardening and curator-event lifecycle fixes are already ancestors of
`main`. Production migration/resync remains a separate explicitly authorized
operation; code changes alone do not alter the production D1.
