# PR #6 — Leads staging validation runbook

This runbook is the release gate for PR #6. It is intentionally staging-only.

## Non-negotiable safety rule

`wrangler.jsonc` is now safe-by-default for PR validation: the top-level Worker is `work-os-2-staging` and its `DB` binding has no production database ID. Cloudflare/Wrangler may provision an isolated staging D1 resource for that binding on the first staging deploy.

Production is available only through the explicit `production` Cloudflare environment, whose Worker is `work-os-2` and whose `DB` binding is `work-os-production` (`dbe3fce7-5c0c-4ae4-9497-dc236a4e8141`). Because this project uses the Cloudflare Vite plugin, production must be selected at build time with `CLOUDFLARE_ENV=production`; do not set that variable during PR #6 staging validation.

Production must remain untouched until an explicit cutover approval.

A staging validation run must use a separately identified Cloudflare D1 database and a separately reachable staging/preview deployment. Record the staging database name + ID before any data migration or restore write.

## Gate 0 — identify staging resources

Before any migration:

1. Confirm the Cloudflare account is the expected Work OS account.
2. Build/deploy the default staging configuration only; do not select `production`.
3. Identify the isolated D1 resource provisioned/bound to `work-os-2-staging`.
4. Record its database name and ID in the validation notes.
5. Confirm it is **not** `work-os-production` and its ID is **not** `dbe3fce7-5c0c-4ae4-9497-dc236a4e8141`.
6. Confirm the staging Worker binds `DB` to that staging database only.
7. Stop immediately if any command resolves to the production database.

## Gate 1 — source snapshot and baseline

Use a real-data staging copy only. Before applying 0014/0015:

- preserve the original source backup and SHA-256;
- capture schema/migration state;
- capture owner-scoped row counts for every backup table;
- capture representative nullable/legacy fields;
- capture historical lead/student/lesson/event metrics;
- capture FK check result.

Do not mutate the source snapshot after baseline capture.

## Gate 2 — migrations

Apply migrations through:

- `0014_leads_domain.sql`
- `0015_leads_hardening.sql`

Then verify:

- migrations completed without destructive business-row changes;
- FK checks pass;
- owner-scoped entity counts reconcile;
- historical event totals still reconcile;
- nullable legacy dates/times remain unchanged unless migration semantics require otherwise;
- no managed lead is silently created from an unresolved conflict.

## Gate 3 — Leads migration/import behavior

Exercise the real-data staging copy with representative records:

- native + legacy leads;
- multiple students on one contact;
- multiple lessons / repeat booking;
- linked reschedule;
- archived/restored lead;
- pending curator request;
- incomplete imported lesson with missing time;
- unknown imported business dates;
- normalized phone/Telegram duplicate candidates.

Explicitly test a repeat legacy sync conflict and confirm the conflicting chunk rolls back while earlier completed chunks remain committed.

## Gate 4 — schema-5 backup/restore rehearsal

Restore into a **fresh empty isolated staging database** only.

Required checks:

1. Validate schema version, expected owner, table/count inventory and SHA-256.
2. Seed the matching owner.
3. Restore all schema-5 tables, including provenance/chunks, soft-deleted messages and command receipts.
4. Do not restore ephemeral guards or technical revision values.
5. Run FK checks.
6. Compare every restored table/column and count to the export.
7. Replay an original booking receipt and confirm no extra lesson/event is created.

Never use the restore procedure as an overwrite path for a live database.

## Gate 5 — authenticated UI smoke QA

Use the reachable staging deployment and an authenticated account.

### Desktop

- list/search/filter leads;
- open/edit/save lead;
- create/archive/restore;
- add/edit students;
- book repeat lesson;
- linked reschedule;
- reminder states and sent/skipped actions;
- follow-up/overdue;
- curator confirm/cancel;
- internal conversation and TXT export;
- stale form recovery;
- uncertain-response retry/reload behavior;
- double-click/write protection;
- long names/URLs and validation errors.

### Mobile / narrow viewport

Repeat the critical create/edit/book/reschedule/archive flows and verify no clipped controls, unusable dialogs, or horizontal overflow that blocks actions.

### Keyboard

Verify focus entry, tab order, visible focus, dialog focus containment, Escape behavior, save/error focus recovery and no accidental background activation.

## Gate 6 — release decision

PR #6 stays draft until all of the following are recorded as passing:

- real-data staging migration 0014 + 0015;
- count/legacy/event reconciliation;
- repeat-sync conflict rollback;
- schema-5 restore rehearsal;
- authenticated desktop QA;
- narrow mobile QA;
- keyboard QA.

Only after those gates pass may PR #6 be considered ready for review/merge. Production deploy/migration remains a separate explicit cutover action.
