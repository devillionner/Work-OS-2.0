# Work OS 2.0 — actual-code pre-UX functional audit

Updated: 2026-09-14. This audit records the actual implementation state after comparing current code and the open pre-UX PRs against `PRODUCT_REQUIREMENTS.md` and `ROADMAP.md`.

This document exists because the canonical requirement registry was last broadly reconciled before several later functional PRs. A `не реалізовано` or `частково` label in that registry must not be treated as proof that code is missing. Before new functional work, verify the actual code and the PR chain listed below.

## Safety boundary

- Production Worker `work-os-2`, production bindings and production D1 are not part of this audit or acceptance work.
- No production SQL writes, deploys or binding changes are permitted without separate direct user approval.
- `Prototype-Checker` remains read-only.
- Staging acceptance is allowed only against `work-os-2-staging` and `work-os-2-staging-db` after target verification/dry-run.
- PR #23 pins the default deploy config to the staging Worker/D1 and adds a regression guard separating staging from production.
- No local or staging result is inferred while Remote Desktop Commander is offline. A direct RDC ping on 2026-09-14 returned no available device.

## Current pre-UX PR stack and gates

| PR | Scope | Current gate |
| --- | --- | --- |
| #23 | CAL-01/CAL-02 calendar workday + CRM context; staging deploy binding guard | GitHub CI green; staging acceptance pending |
| #24 | bounded/streaming long CRM conversation export | GitHub CI green; staging acceptance pending |
| #25 | analytics day/week/month/year/custom periods + joined→publication funnel | GitHub CI green; staging acceptance pending |
| #26 | report source-event drill-down | GitHub CI green; staging acceptance pending |
| #27 | cohort analytics + CSV export | GitHub CI green; staging acceptance pending |
| #28 | create lead from selected historical report date | GitHub CI green; staging acceptance pending |
| #29 | shared bounded JSON mutation boundary / same-origin hardening | GitHub CI green; legacy migration-control POST intentionally deferred |
| #30 | REPORT-19 backdated response/booking label | GitHub CI green; staging acceptance pending |
| #31 | CHAT-09 archive suggestion after repeated snooze | implemented; superseded in later chat stack for integration purposes |
| #35 | duplicate review domain / manual duplicate manager | GitHub CI green; staging acceptance pending |
| #36 | Telegram/WhatsApp archive leave checklist | GitHub CI green; staging acceptance pending |
| #37 | Telegram per-account warm-up checklist | GitHub CI green; staging acceptance pending |
| #38 | state-preserving chat CSV round-trip | GitHub CI green; staging acceptance pending |
| #39 | official/personal scripts + knowledge separation and item version history | GitHub CI green; migration/backup/staging acceptance pending |
| #40 | historical publication correction | GitHub CI green; staging acceptance pending |
| #41 | historical lesson-result correction | GitHub CI green; staging acceptance pending |
| #42 | historical joined-chat correction | GitHub `Local checks` #117 green on `f1a0ae0`; staging acceptance pending |
| #43 | manual Telegram schedule capacity guard | GitHub CI green; staging acceptance pending |
| #45 | explainable low-efficiency/strong-signal analytics + current archive-reason summary | GitHub `Local checks` #125 green on `ce686a8`; staging acceptance pending |
| #46 | daily time-series analytics for joins/publications/responses/bookings/completed lessons | final GitHub CI pending at this update; stacked on #45 |

PR #44 was closed as redundant after the full open-PR audit because it duplicated #31/#35/#36. Its stricter restore behavior was not promoted because canonical #36 deliberately preserves the existing restore contract.

All functional PRs remain draft until the appropriate local/staging acceptance pass. None is evidence of production deployment.

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
- REPORT-19: PR #30 derives and exposes the visible `Додано заднім числом` state without adding a mutable counter.
- REPORT-21: daily/monthly goal history is versioned; later edits do not rewrite past plan/fact.
- REPORT-23: selected report date has bounded owner-scoped source/detail lists.
- REPORT-17 is covered as a stacked workflow: historical lead (#28), publication (#40), lesson result (#41) and joined chat (#42).

### Chat / import workflow

- CHAT-09 is implemented in #31: lifetime snooze history drives a non-blocking archive suggestion after repeated deferrals.
- CHAT-13/14/26/27/29 are implemented in #35: owner/platform-scoped duplicate review, canonical-link confidence, same-name manual candidates, Telegram account scope, guarded rename and explicit archive as `Дублікат`.
- CHAT-23/25 are implemented in #36 as a recoverable leave-confirmation checklist for archived joined Telegram/WhatsApp chats.
- IMPORT-06 is implemented in #38 as a bounded state-preserving CSV export/import with preview, stale-preview guard and owner/account checks.
- IMPORT-10 manual correction is already available for ordinary existing chats through `Профіль чату`: the chat name is editable and saved through the existing optimistic state-token/profile write path. Duplicate review adds another guarded inline rename path; do not build a third manual rename mechanism.

### Telegram schedule / publishing

Actual `telegram-schedule` code plus #37/#43 covers the previously open manual-schedule and warm-up gaps:

- Telegram-only schedule; exact `intervalMinutes = 60 / rate`, fractional minutes and no artificial 60/hour cap.
- Manual 24-hour start plus `Від зараз`.
- First generated slot is start + interval.
- Automatic eligible-chat assignment and account-isolated slots/settings/progress.
- Publication completes the matching account/chat slot.
- Clear all pending slots.
- Unlink/edit one slot without shifting other slot times.
- Compact plan, next action, completed/total and copy-plan action.
- Per-account manual selection with search, select-all, random selection and switch back to automatic mode.
- #37 adds the explicit per-account warm-up checklist while keeping it manual and auditable.
- #43 rejects manual generation before writes when the selected eligible set cannot fill every requested slot.

### Library / knowledge

- #39 separates advertisements, official scripts, personal scripts and knowledge while preserving the existing lead-card script workflow.
- #39 adds monotonic item versions plus immutable snapshots for create/update/archive/restore and exposes owner-scoped history.

### Calendar / analytics

- CAL-01/CAL-02 are implemented in #23 and are waiting for staging acceptance, not functional design.
- ANALYTICS-02 is implemented in #25 (day/week/month/year/custom bounded period).
- ANALYTICS-12 and ANALYTICS-17 are implemented in #27 (CSV export and acquisition cohort result view).
- ANALYTICS-08/09/19 recommendation/archive-summary slice is implemented in #45. Recommendations are derived/read-only, require meaningful sample sizes and never auto-archive/restore/change cadence.
- ANALYTICS-03 daily trend series is implemented in #46; final CI evidence is still pending at this audit revision.

## Confirmed remaining functional gaps before declaring pre-UX complete

These are actual-code gaps after accounting for the current open PR stack, not statuses copied blindly from the registry.

### P1 — manual platform workflow

1. **Automatic true-name retrieval / global name check (remaining IMPORT-07/09/12).** Manual correction is already implemented. What remains is external retrieval of real names for new and existing Telegram/WhatsApp/Viber chats plus one global progress/error workflow. It must not silently overwrite a trusted manual name with a lower-confidence result and depends on external platform/browser behavior.

### P2 — CRM workflow

1. **Conversation media attachments (LEAD-23).** Lead conversation persists text messages; no complete media attachment lifecycle, storage policy, backup/restore semantics and safe rendering path has been confirmed. This is not safe to fake by storing arbitrary blobs/base64 in D1.

### P3 — report / analytics depth

1. **REPORT-22 explicit automatic-fact vs manual-correction reconciliation.** Event-derived totals, revision history and source drill-down exist, but the current report model has event truth plus free-form report text, not structured numeric manual overrides. A real implementation requires an explicit correction data contract; parsing numbers from the report textarea would be fragile and misleading.
2. **Analytics historical archive-reason journal (optional depth).** #45 safely summarizes chats that are currently archived and whose current `archived_at` is inside the selected period. A full history including chats later restored would require archive reason to be journaled as explicit event metadata rather than decoded from positional state-token arrays. Do not introduce a hidden dependency on state-token indexes.

### P4 — reliability / release evidence

1. **Same-second report staleness precision.** `activitySummaryStatement` considers a change stale only when `occurred_at > submitted_at` or `cancelled_at > submitted_at`. Events created/cancelled in the exact same integer second after submission can be missed. Changing this to `>=` would create false stale states for events that already existed before submission in that same second. The safe model is a monotonic revision scoped by `user_id + business_date`, captured by the report at submit; a global workspace revision would cause false stale states when another date changes.
2. **Uniform mutation hardening.** #29 covers normal daily mutation routes. The large legacy migration-control POST still uses the older direct JSON parser; change it only with full local verification available because this is a high-risk migration path.
3. **Performance gate.** Synthetic checks already cover 10k existing chats and 10k leads / 100k events. Final P4 acceptance still requires recorded query counts/rows/payload, p50/p95, EXPLAIN review and UI latency on one fixed local/staging stand, including the current stacked features.
4. **Final desktop/mobile/keyboard/a11y and staging acceptance.** These are evidence gates, not reasons to invent more business functionality. They remain blocked while the authorized remote machine is offline.

## Deliberately deferred / not a pre-UX functional blocker

- AI generation/adaptation/autoposting remains P6 and requires a new explicit permission before local AI work.
- Exact destructive restore remains separately deferred.
- Production cutover/final migration is P5 and requires explicit user approval after parity/acceptance.
- Visual design polish, layout-system refinement, final mobile styling and visual regression work belong to the design/UX phase once the remaining functional/reliability blockers above are closed.

## Next execution order

1. Keep the open PR stack canonical; do not create duplicate implementations for stale registry entries.
2. Turn every red CI gate green before adding more functional surface area.
3. When Remote Desktop Commander returns, run one full local verify for the accepted combined stack, then a staging-only dry-run/deploy/acceptance with explicit Worker/D1 target verification.
4. Close same-second ordering, remaining mutation-hardening and recorded performance evidence with local/staging verification available; stack the ordering migration after the existing #39 migration to avoid migration-number collision.
5. Only then decide whether external-platform name retrieval, conversation media and full historical archive-reason journaling are required before visual UX work or can be explicitly deferred.
6. When no required real functional gaps remain, stop functional development and mark Work OS 2.0 `pre-UX complete` before starting the design/UX phase.
