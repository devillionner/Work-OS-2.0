# Development status — 2026-09-08

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
- Repeat-import guard for cloud-managed aggregates and cloud backup schema 4.

## Validation

- `npm run lint`: passed (includes all new Leads components).
- `npm run build`: passed; `/api/leads` included in production route output.
- `npm test`: 18/18 passed (13 new D1/domain scenarios and 5 existing migration regressions).
  Covers duplicates, several students/lessons, retry/concurrency, reschedule,
  blank subject/grade validation, reminders, first reply, overdue, archive/restore,
  events/historical metrics, message export, ownership, request validation and DST.
- Migration test uses a **synthetic** 24/5/9 fixture plus a historical event;
  it is not a production database inspection or reconciliation.
- Visual browser QA could not run: this environment's browser blocked the local
  preview URL. Responsive desktop/mobile and keyboard smoke tests remain required
  in a reachable authenticated preview. Do not describe visual QA as passed.

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
  double-counting alongside the real booking.

## Next — Leads cutover gate

1. Review the PR and take a full current D1 backup; retain the original immutable
   Prototype backup referenced in `CUTOVER-2026-09-04.md`.
2. Apply migration 0014 on a staging copy first, then deploy matching code and
   migration to production in a coordinated release. Commands for the existing
   Wrangler setup: `npx wrangler d1 migrations apply DB --local` for local testing;
   `--remote` only during the reviewed production release.
3. Smoke-test authenticated create/edit, two students, repeated booking,
   reschedule, reminders, follow-up, message export and archive/restore on desktop
   and mobile, including keyboard focus and stale-version recovery.
4. Reconcile real production entity counts and historical metrics before/after;
   export schema-4 cloud backup and verify the three new tables are present.
5. Keep Prototype Checker available until these operational checks pass.

Do not start Today, Reports, Analytics or Library while these Leads gates remain.
