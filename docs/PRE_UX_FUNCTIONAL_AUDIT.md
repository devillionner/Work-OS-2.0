# Work OS 2.0 — actual-code pre-UX functional audit

Updated: 2026-09-13. This audit records the actual implementation state after comparing current code and the open pre-UX PRs against `PRODUCT_REQUIREMENTS.md` and `ROADMAP.md`.

This document exists because the canonical requirement registry was last broadly reconciled before several later functional PRs. A `не реалізовано` or `частково` label in that registry must not be treated as proof that code is missing. Before new functional work, verify the actual code and the PR chain listed below.

## Safety boundary

- Production Worker `work-os-2`, production bindings and production D1 are not part of this audit or acceptance work.
- No production SQL writes, deploys or binding changes are permitted without separate direct user approval.
- `Prototype-Checker` remains read-only.
- Staging acceptance is allowed only against `work-os-2-staging` and `work-os-2-staging-db` after target verification/dry-run.
- No local or staging result is inferred while Remote Desktop Commander is offline.

## Current verified pre-UX PR gates

| PR | Scope | GitHub CI state |
| --- | --- | --- |
| #23 | CAL-01/CAL-02 calendar workday + CRM context | green; staging acceptance pending |
| #24 | bounded/streaming long CRM conversation export | green; staging acceptance pending |
| #25 | analytics day/week/month/year/custom periods + joined→publication funnel | green; staging acceptance pending |
| #26 | report source-event drill-down | green; staging acceptance pending |
| #27 | cohort analytics + CSV export | green; staging acceptance pending |
| #28 | create lead from selected historical report date | green; staging acceptance pending |
| #29 | shared bounded JSON mutation boundary / same-origin hardening | green; staging acceptance pending |
| #30 | REPORT-19 backdated response/booking label | green; staging acceptance pending |
| #31 | CHAT-09 archive suggestion after repeated snooze | green; staging acceptance pending |
| #32 | SCHED-01 manual Telegram set must cover requested slots | green; staging acceptance pending |

All listed PRs remain draft until the appropriate local/staging acceptance pass. None is evidence of production deployment.

## Registry entries already implemented in actual code

The following are examples of requirements whose old registry status is stale and which must **not** be reimplemented as new features.

### Workday / Today

- CORE-09: Today renders `WorkdayCard`; the owner-scoped Workday API supports start, pause, resume and end. Ending a workday checks unfinished lead tasks and requires explicit confirmation when work remains.
- CAL-04 Today-side reminder actions: due reminders can be copied, marked sent and opened at the exact lead from the Today queue.

### CRM

- LEAD-15: lesson editor shows tomorrow / day-after-tomorrow recommendations.
- LEAD-24 / SCRIPT-04: relevant Library scripts are surfaced in the lead card (merged PR #22).
- LEAD-39: `leads.is_student` is persisted and editable as `Контакт навчається`; when booking and it is `0`, the main contact is excluded from `Кого записуємо`, while added students remain available.
- LEAD-40: `response_cancel` / `response_restore` are canonical lead commands. They cancel/restore the original response event for metrics and append audit events without deleting the lead.

### Reports / goals

- REPORT-03: the administrator Google Form has an explicit manual-open action; Work OS does not claim automatic submission.
- REPORT-09: Today/report tooling exposes the current day plan from daily/monthly goals and focus directions.
- REPORT-10: intermediate report checkpoints are implemented with their own persisted API/component.
- REPORT-11: Reports exposes a previous-final-report reminder.
- REPORT-21: daily/monthly goal history is versioned (merged PR #20); later edits do not rewrite past plan/fact.
- REPORT-23: selected report date has bounded owner-scoped source/detail lists.
- REPORT-19: PR #30 derives and exposes the visible `Додано заднім числом` state without adding a mutable counter.

### Telegram schedule / publishing

Actual `telegram-schedule` code already covers most items that the older registry still labels absent:

- Telegram-only schedule; exact `intervalMinutes = 60 / rate`, fractional minutes and no artificial 60/hour cap.
- Manual 24-hour start plus `Від зараз`.
- First generated slot is start + interval.
- Automatic eligible-chat assignment and account-isolated slots/settings/progress.
- Publication completes the matching account/chat slot.
- Clear all pending slots.
- Unlink/edit one slot without shifting other slot times.
- Compact plan, next action, completed/total and copy-plan action.
- Per-account manual selection with search, select-all, random selection and switch back to automatic mode.
- PR #32 closes the remaining SCHED-01 guard: manual generation is rejected instead of producing empty slots if the selected eligible set is smaller than the requested slot count.

### Calendar / analytics

- CAL-01/CAL-02 are implemented in PR #23 and are waiting for staging acceptance, not functional design.
- ANALYTICS-02 is implemented in PR #25 (day/week/month/year/custom bounded period).
- ANALYTICS-12 and ANALYTICS-17 are implemented in PR #27 (CSV export and acquisition cohort result view).

## Confirmed real functional gaps before declaring pre-UX complete

These are actual-code gaps, not statuses copied blindly from the registry. They remain candidates for functional work, subject to scope/priority and direct code verification before implementation.

### P1 — manual platform workflow

1. **Duplicate manager (CHAT-13/14/26/27/29).** There is canonical link normalization for bulk import, but no complete user-facing duplicate review workflow across active/waiting/archive. Required behavior: exact normalized-link duplicates have highest confidence; equal normalized names with different URLs are candidates only; user can open both, rename inline, and archive an active duplicate with reason `Дублікат`. Telegram scope must honor active account ID.
2. **Archive leave checklist (CHAT-23/25).** Telegram/WhatsApp joined chats do not yet have the explicit recoverable “still need to leave the messenger chat” lifecycle that gates permanent deletion and changes restore-to-rejoin behavior after confirmed leave.
3. **Existing chat rename / name maintenance (remaining IMPORT-10 plus IMPORT-07/09/12).** New names are editable during bulk preview, but a complete existing-chat rename/global name-check workflow is not present. Automatic true-name retrieval requires careful external-platform/browser behavior and must not silently overwrite a trusted manual name.
4. **CSV chat state import/export (IMPORT-06).** No complete state-preserving CSV round-trip was confirmed.
5. **Telegram warm-up plan (PUB-16).** Multiple accounts and break counters exist, but the explicit per-new-account warm-up checklist/instructions/progress is not present.

### P2 — CRM / knowledge workflow

1. **Conversation media attachments (LEAD-23).** Lead conversation currently persists text messages; no complete media attachment lifecycle was found.
2. **Library script/knowledge versioning and separation (SCRIPT-01–03, KNOW-01/02).** Relevant scripts can already be used from lead cards, but official vs personal knowledge organization and version history are not complete.

### P3 — report / analytics depth

1. **REPORT-17 remainder.** Historical lead creation exists (PR #28), but direct historical correction/creation paths for chat, publication and lesson result are not yet a complete single workflow.
2. **REPORT-22 explicit manual-correction comparison.** Event-derived totals and editable report text are separated, and source events are drillable in PR #26, but there is not yet a structured per-number “automatic fact vs manual correction” reconciliation model.
3. **Analytics visual/recommendation layer.** Time series charts, archive-reason analysis and explainable low-efficiency recommendations are not complete; current analytics is primarily metric/table based. These should not change event truth.

### P4 — reliability / release evidence

1. **Same-second report staleness precision.** `activitySummaryStatement` currently considers a change stale only when `occurred_at > submitted_at` or `cancelled_at > submitted_at`. Events created/cancelled in the exact same integer second after submission can be missed. Changing this to `>=` would create false stale states for events that existed before submission in that same second. A monotonic submission/event revision marker (or equivalent exact ordering evidence) is required before this can be closed correctly.
2. **Uniform mutation hardening.** PR #29 covers the normal daily mutation routes. The large legacy migration-control POST still uses its older direct JSON parser and should be changed only with full local verification available.
3. **Performance gate.** Existing synthetic tests are useful, but final P4 acceptance still requires recorded 10k chats / 10k leads / 100k events measurements, query counts/rows/payload, p50/p95, EXPLAIN review and UI latency on a fixed local/staging stand.
4. **Final desktop/mobile/keyboard/a11y and staging acceptance.** These are evidence gates, not reasons to invent more business functionality. They remain blocked while the authorized remote machine is offline.

## Deliberately deferred / not a pre-UX functional blocker

- AI generation/adaptation/autoposting remains P6 and requires a new explicit permission before local AI work.
- Exact destructive restore is deferred separately.
- Production cutover/final migration is P5 and requires explicit user approval after parity/acceptance.
- Visual design polish, layout system refinement, final mobile styling and visual regression work belong to the design/UX phase once the functional blockers above are closed.

## Next execution order

1. Do not duplicate stale registry items; verify actual code first.
2. Close small, independently testable real gaps through targeted domain/API/UI slices.
3. When Remote Desktop Commander returns, run one full local verify for the combined accepted stack, then staging-only dry-run/deploy/acceptance with explicit Worker/D1 target verification.
4. Run final reliability/security/performance acceptance and update this audit with evidence.
5. When no real functional gaps remain, **stop functional development** and announce that Work OS 2.0 is at `pre-UX complete` and ready for the design/UX phase.
