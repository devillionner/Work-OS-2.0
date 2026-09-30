## 2026-09-30 — Discovery UI/UX dedupe release v0.2.74

- Root cause дубля review: браузерний фінальний outcome уже був durable у chat_discovery_candidates, але modal рендерив local candidate і persisted candidate поруч та додавав обидва в tab counts.
- UI тепер зводить результати за canonical platform + invite, віддає пріоритет persisted candidate і додає до snapshot-counts лише справді нові local outcomes, що з’явилися після останнього workspace load.
- Прибрано dead local-review action, який пропонував «додати» review до factual target qualification. Для persisted review/target primary operator actions тепер видно прямо на card; technical/manual detail лишається secondary.
- Summary і tabs перейменовані в operator language, wide desktop має 6 рівних stat tiles, empty state пояснює конкретний вибраний фільтр.
- Physical staging check додатково виявив mobile overflow: default DialogContent width перемагав non-important viewport width. Fix використовує important dynamic-viewport width та збільшує ключові mobile touch targets; desktop hierarchy не змінена.
- tests/chat-discovery-ui.test.mjs оновлено регресіями для unique merge/counts, direct actions, dynamic viewport width і contextual empty states.
- Canonical autonomous prompt синхронізовано з реальною persistence-моделлю: raw source/run/queued state лишається local, завершені factual outcomes зберігаються як durable dedupe, а explicit operator action потрібна лише для import target у main chat queue.
- P4-A functional closure не змінюється; throughput objective не заявляється як виконаний. P4-A-PERF лишається окремо, наступний functional roadmap slice — confirmed-send WhatsApp autopost.

## 2026-09-29 — WhatsApp Discovery functional closure accepted

**Operator-usable: yes for the Discovery workflow. Throughput SLA: no, not met.**

Accepted physical evidence on code/runtime `a25653d9d9a878afc2e3455461637443927b2ce6`:
- staging build identity exactly matched `a25653d`;
- workstation `work-os-discovery.service` was active; `chat-discovery-runner.mjs`, `whatsapp-web-cdp.mjs`, and `chat-discovery-source-crawl.mjs` matched current GitHub blobs byte-for-byte;
- live run `56448714-2f0b-4b75-938c-ae4a255eb6d0`: sourceTotal 2,391, cursor 1,215, searched 6,026, processed 65, duplicates 54; final local states were 8 rejected, 1 review, 2 skipped, 1 unavailable, 0 target;
- fresh-join acceptance: `Загальний` (702 members, joined, topic match, writable) became durable `review` with reasons `fresh_join_history_unavailable`, `unknown_ads_allowed`, `unknown_activity`. WhatsApp does not expose pre-join messages, so this is the correct fail-closed result; it does not count as a confirmed target;
- factual reject acceptance: `Bali Ukraine | Балі Україна` had 24 members and no write permission and was rejected without weakening criteria;
- source degradation remained visible: Brave rate limiting/cooldown reduced optional web fallback while Telegram-directory crawling continued.

Closure interpretation:
- Discovery start/stop/resume, source crawl, dedupe, bounded metadata/join retries, missing-module fallback, joined identity recovery, requalification without repeat join, factual outcomes, manual-review lane, and durable result memory are accepted as the completed P4-A functional slice.
- The requested target rate (≥12 confirmed targets/hour) is **not** claimed. The limiting factor is fresh qualifying source supply, not current WhatsApp qualification speed/correctness. This is tracked as P4-A-PERF rather than keeping the functional workflow open indefinitely.
- No production D1 write/migration was performed for this closure.

## 2026-09-29 — live WhatsApp module fallback
- Physical inspection of the authenticated WhatsApp page found WAWebGroupQueryJob, WAWebCollections, WAWebWidFactory and WAWebChatLoadMessages present, but WAWebGroupInviteJob unavailable. Stored candidate “Загальний” had consequently exhausted retries with direct_join_unavailable.
- Runner now falls back to its existing exact-invite WhatsApp UI adapter when the direct join module is unavailable; approval-required and invalid-invite handling remains fail-closed. Known joined-chat inspection no longer requires an unused join module.
- Four runner behavioral checks pass, including the new missing-module fallback case; updated the regression harness for browser-local feedback introduced by 507378c.
- Real UI fallback acceptance and the target-rate objective remain pending at this commit. No claim that the recovered candidate meets all target criteria.

## 2026-09-29 — live supply bottleneck and concurrent handoff correction
- Reviewed ae028ce, 26861a7 and 507378c; preserved their bounded search plan, deeper WhatsApp history and browser-local source feedback. Staging /api/build was 507378c and all three workstation runner hashes matched that exact source.
- UI-resumed acceptance at 15:34:29–15:39:21 Europe/Kyiv (291.945 seconds): cursor 327→516, reported search attempts +931, found invites +57, duplicates +57, new candidates 0, targets 0. Stopped using the UI and retained cursor/results. This measures source starvation, not WhatsApp qualification speed.
- Brave returned rate limiting. Two bounded Bing RSS probes returned no items; DuckDuckGo returned an access challenge. No challenge bypass or alternate provider was added without a useful verified result.
- Fixed source-batch merge overwriting newer queued-candidate checkpoints. Latest candidate state now wins even while still queued, preserving attempts and joined identity.
- Serialized Brave requests through a shared provider queue; a 429/challenge is not immediately retried and other waiting jobs honor the same cooldown.
- Source warnings now reach the UI separately from fatal failures; reduced coverage is visible instead of silently presenting a healthy empty search. Hydration restores the actual saved goal.
- Two new behavioral tests passed (concurrent checkpoint merge/warning delivery and one rate-limit request across parallel jobs); three changed source files parsed. Full verify:local not run under remote-only constraints.
- 12 factual targets/hour remains UNMET. Remaining external/product blocker: a repeatable supply of fresh qualifying invite links; no throughput acceptance or real-target gate is closed by this change.


## 2026-09-29 — Discovery reliability and measurable yield
- Live baseline on fd769da: 54 persisted candidates, zero targets; primary outcomes 26 below minimum size, 8 approval-required, 2 cannot-write, 16 invalid links, 1 incomplete joined qualification and 1 paused-unverified. These are stored outcomes, not a timed throughput benchmark.
- Empty successful Telegram-directory results now allow the web fallback. Graph/directory sources are marked visited only after successful reading. Source outcome feedback adjusts graph priorities; it does not promise a qualified audience.
- Three bounded qualification attempts preserve joined identity between attempts. The adapter reuses fetched invite metadata, applies one shared runtime deadline and reuses an in-flight join promise after a timeout. Final persistence failures retry the saved outcome without repeating messenger actions.
- Pause keeps unattempted candidates queued; completed archive/dedupe outcomes remain preserved. Explicit recovery is available for incomplete, paused-unverified and retry-exhausted outcomes. No automatic mass reprocessing or archive deletion.
- Result handoff merges current session state after persistence, preserving concurrent pause/source updates. Session metrics record completions, outcomes, reasons and elapsed candidate time including retries.
- Activity now means today or yesterday in Europe/Kyiv; no relaxation of audience, size, write-permission or advertisement requirements.
- Seven new behavioral regressions passed against the proposed sources in memory (executed in three groups); JS/TSX syntax checks passed. No local checkout or production access. Full npm run verify:local was not run under the remote-only constraint.
- Deployment identity, refreshed runtime and physical yield are pending at this commit. GO-LIVE gates and the 12-target/hour objective remain open until measured; do not describe these code fixes as a completed throughput acceptance.


## 2026-09-28 — pause no longer loses Discovery momentum
- Manual stop now freezes the local run immediately, persists unfinished queued candidates as `paused_unverified` archive/dedupe outcomes, and keeps existing target/rejected/skipped/unavailable outcomes intact.
- The stopped status block shows an animated archive summary with target/non-target/unavailable/unverified counts and the saved source cursor.
- `Продовжити автопошук` resumes from the same cursor/candidates/counters with a fresh run id; it no longer reconstructs an empty run from cursor 0 after a deliberate pause.
## 2026-09-28 — saved target operator decision

- Persisted factual targets remain unimported until the operator decides whether to keep them.
- Saved targets now expose explicit `Лишити в роботі` and `В архів` actions. Operator archive writes `operator_rejected` without fabricating a failed factual criterion.
- Keeping an already joined target reuses its stored factual preflight through the confirm path, so it becomes an already joined/ready Work OS chat instead of being sent back to `to_join`.
- Manual archive of a joined target reports that WhatsApp still requires a real leave; Work OS does not fabricate external leave confirmation.

## 2026-09-28 — persistent local Discovery outcomes / durable dedupe

- Local WhatsApp qualification outcomes now persist through the authenticated Work OS page after factual preflight, while raw source hits remain browser-local.
- Confirmed targets are stored as unimported `target` candidates for manual operator review; the runner does not auto-import them into the main chat queue.
- Rejected, approval-required/skipped and unavailable outcomes are stored as persistent Discovery archive/dedupe anchors with reason codes.
- `prepareLocalPreviews` already excludes links present in either `chats` or `chat_discovery_candidates`; therefore local clear/restart no longer causes persisted outcomes to be requalified.
- Routine Discovery reset now preserves candidate/source history and only clears run/progress state.
- UI copy now states that persistent dedupe is enabled and labels targets as requiring manual review.

## 2026-09-28 — Discovery source recovery and observable outcomes

- Read-only diagnosis against base main `075f7e4aeb6db87dbddfd02dea1985943a7610d2`: the operator run ended at 25 invites, 8 duplicates, 17 non-target outcomes and 0 targets. The live modal exposed zero rows in its rejected/unavailable/all tabs despite those local outcomes.
- Source runner now loads the canonical `lib/chat-discovery/seeds.ts` workbook into memory and builds the full compatible city/country keyword plan, with country interleaving, Latin city aliases and bounded same-channel Telegram history fallback. Missing village/district/institution values are not invented. Successful Telegram reads have a bounded 15-minute in-memory cache.
- HTTP/network/search-challenge and preview-ingestion failures retain the source cursor. Retries back off for 60 seconds; three failed batches pause with an explicit resumable source error. Only successful completion of the plan may be described as source exhaustion. Batch handoff no longer truncates source pages while advancing past them.
- Local rejected/skipped/unavailable candidates are visible with reasons. Full messenger inspections and processed outcomes have separate counters. Unknown facts are not silently called a bad audience; bounded retries end with an explicit incomplete result and do not trigger leave.
- Internal WhatsApp invite metadata is an optional acceleration: failure falls back to exact-invite UI inspection. Verified metadata can fill missing post-join member-count/topic/policy facts; activity must still be read from the conversation. Community admin-only labels are recognized.
- Source handoff merges the latest browser state and discards a response if its run was replaced. Actual group IDs, when available, replace name/member-count heuristics for duplicate identity; final target persistence still requires explicit operator confirmation.
- Verification before this change: eight focused behavioral regressions passed using exact source in memory; five changed runtime/TSX files parsed/transformed successfully. No local repository was created. Full `npm run verify:local` was not run in this remote-only session; it remains unverified.
- Deployment and physical acceptance are not claimed by this entry. GO-LIVE-04/06/08 remain open until exact staging identity, refreshed workstation runner and a real qualifying target are observed. Existing completed local results are preserved for review; no production/D1 mutation or migration is part of this change.

# Development status — 2026-09-25

## 2026-09-27 — Discovery runtime startup + latency hardening

- Current CachyOS acceptance machine now has an enabled user service `work-os-discovery.service`. It starts automatically after login, downloads the canonical Discovery runner + WhatsApp CDP adapter from current GitHub `main` into `/run/user/1000/work-os-discovery-runtime`, and runs them without a persistent local clone. If Opera/Work OS is not ready yet, the runner idles and can acquire the executor token later.
- `whatsapp_join_retry_later` no longer freezes the whole browser-local queue for five minutes. That invite is skipped for the current run and the next candidate may continue immediately.
- WhatsApp inspect and verified leave now share one 45-second operation budget instead of resetting the full timeout at each UI phase. A page that remains `page_not_ready` through the budget is skipped for the current run with a short 5-second browser recovery pause, preventing one slow invite from trapping the queue indefinitely.
- Local task ordering now prefers strong Ukrainian-community labels and demotes obviously malformed scraped labels. This changes only processing order; factual target qualification criteria remain unchanged.
- Exact staging build `cee2731b77d760f0d26ada371d460c2ce56bc52f` is live and matches `main`.
- Live acceptance run after the hardening observed 54 discovered invites, 34 duplicates and 13 completed local outcomes with 8 still queued at the observation point. WhatsApp itself returned several factual `retry later` and approval-required outcomes; no target had reached the final local list yet. The remaining throughput limit is therefore primarily real WhatsApp invite/join latency and external retry behavior rather than the previous runner-wide stall.


## 2026-09-25 — Discovery yield bootstrap

- Live diagnosis found the main yield bug: local-first Discovery exhausted the huge Telegram keyword plan before it ever reached the existing curated Ukrainian chat directories.
- A direct benchmark of the existing curated sources returned 32 WhatsApp invite records in about 2.2 seconds, proving the useful supply was already available but ordered behind thousands of low-yield search tasks.
- Clean local Discovery now runs one curated bootstrap batch first, then continues through the workbook Telegram/public search plan.
- Added four additional verified public Ukrainian-community sources for Berlin/Germany, the Netherlands and Prague. These remain read-only external sources and do not change the D1 persistence boundary.
- Added eight more directly verified Ukrainian-community pages spanning Spain, Italy, Austria, the Netherlands, Finland, Germany and Slovakia; the benchmark exposed 11 additional canonical WhatsApp invite links before D1 dedupe.
- Added four more verified Telegram community sources for Bremen, Toronto, Waterloo and London. Local preview naming now prefers a clean source/community label when HTML extraction yields truncated or markup-like text.
- Search remains local-first: only exact invite dedupe reads may touch D1 before operator confirmation; no intermediate candidate/run/source writes are reintroduced.

## 2026-09-25 — local-first fast Discovery with strict D1 boundary

- The operator clarified the persistence model: autonomous search must not create D1 run/candidate/source/chat rows while it is still discovering and filtering.
- Discovery source crawl now lives in browser session state. One local cycle searches up to 6 Telegram/public queries and immediately continues until the requested shortlist is reached or sources are exhausted.
- The source endpoint performs no INSERT/UPDATE during search. If a burst actually finds invite links, it performs only targeted indexed duplicate reads for those exact normalized links; an empty-yield burst performs no candidate/chat dedupe reads.
- Local UI progress records processed invites, selected candidates, source-level rejects, duplicates, query count and last activity without recurring D1 workspace polling.
- The operator can remove bad local rows and review the shortlist. Only the explicit final «Додати … до приєднання» action crosses the persistence boundary and creates canonical D1 candidate/chat state.
- Full criteria that require messenger facts (member count when unavailable publicly, activity, write permission and ad policy) remain post-join qualification facts; the local search result is therefore a prequalified shortlist rather than a falsely claimed final target.
- The paired executor is hard-disabled from source crawling and its idle queue read no longer queries the latest Discovery run, reducing background D1 reads.

## 2026-09-25 — stale Discovery imports cleanup

- The clean Discovery reset intentionally preserved linked Work OS chats as dedupe anchors, which left old auto-imported rows visible in the main WhatsApp queues.
- Added a recovery action that archives only stale WhatsApp chats proven to originate from `chat_discovery_imported`, have no current Discovery candidate, have never been joined, and have no publications or leads.
- The cleanup preserves those rows as dedupe anchors so the fresh run does not immediately rediscover the same old links.
- Any stale imported chat that was actually joined is reported separately and is not silently archived; it requires verified external WhatsApp leave first.

## 2026-09-25 — clean Discovery restart support

- Added an authenticated `reset` action for Chat Discovery that removes only Discovery runs, candidate rows and their source rows for the current user.
- Linked Work OS chats are intentionally preserved and remain dedupe anchors, so a clean Discovery restart does not delete real chat records and does not immediately rediscover the same old links.
- A reset deletes run history, so the next run starts at Telegram/public source cursor 0 with clean progress counters.
- Fixed a stale `activeRun` reference in the browser-local preview path; its member threshold now comes from the explicit request as intended.
- This reset is intended for recovery from a stale/backlogged acceptance run before starting a fresh autonomous source search.

## 2026-09-25 — Discovery operator UX clarity

- Live screenshot review showed that the modal exposed implementation concepts (`Query`, local/D1 state, raw candidate count, executor card) more prominently than the actual operator goal.
- The modal is now goal-first: a single progress card shows confirmed targets versus the active goal, current autonomous activity, work queue, WhatsApp pending, rejected and unavailable counts.
- The active run goal is shown consistently in the disabled goal field (for example 10 rather than stale local default 50).
- Default candidate view is `У роботі`; candidate cards lead with a plain-language automation state and keep the 10-point qualification grid, raw link/source details and manual controls collapsed.
- Noisy scraped source names are sanitized/fallback-labelled in the main list. Executor and search-source counters remain available under technical disclosures instead of dominating the workflow.

## 2026-09-25 — autonomous Discovery live progression

- Exact staging build `c06cbcf674984acac61d713f1b3a5f868506195e` physically completed a real rejected-chat path: WhatsApp joined `Technical Support`, Work OS observed 18 members and admin-only posting, classified it rejected, then the refreshed adapter completed verified external leave; the canonical callback archives the chat before persisting `membership_state=left`.
- The runner was moved into a transient user service for acceptance so it survives the tool terminal session while remaining volatile and outside the repository.
- The live run continued across multiple candidates and advanced the autonomous source plan. This exposed a new blocker: fully inspected joined chats with incomplete factual target evidence remained `review` and were eligible for repeated inspection, while source-derived audience inference could survive a real messenger inspection.
- Current blocker fix makes exact executor inspection authoritative for audience evidence and fail-closes a fully inspected joined chat with unresolved required target criteria to `rejected/leave` rather than manual review. Manual/recovery inspection keeps the existing `review` behavior.
- WhatsApp group-info enrichment now waits briefly for the current drawer to render before reading member count/policy facts, reducing false unknowns without weakening target criteria.
- GO-LIVE-02 and the factual joined half of GO-LIVE-03 are now physically accepted. GO-LIVE-04 has physical rejected/leave/archive evidence but remains open until a real target reaches usable ready state.

## 2026-09-25 live WhatsApp post-invite target verification

- Live leave-control diagnosis: current WhatsApp renders «Вийти з групи» as an aria-label on an icon-prefixed role button; control discovery/clicking now prefers accessible labels before textContent, preserving exact matching.
- Physical CDP diagnosis reproduced current WhatsApp Web behavior where an invite resolves into the joined chat and the browser URL returns to `https://web.whatsapp.com/`; the chat itself shows factual «Ви приєдналися за запрошенням».
- The adapter now treats that localized post-invite join evidence plus the conversation header as exact-target proof for the invite code that the runner itself navigated to. A generic header without that evidence still fails closed.
- Verified leave now follows the observed WhatsApp target name rather than the noisy source-derived name, so a factual non-target joined chat can be exited and archived automatically.
- Live reproduced non-target evidence: `Technical Support`, 18 members, admin-only posting. Final autonomous goal acceptance still requires the refreshed runner to process the flow end-to-end.
- Follow-up DOM inspection showed that current WhatsApp stores the real group name in `#main header [dir="auto"]`, while `[title]` contains helper text such as «Деталі профілю» or participant lists. Target verification/clicking now prefers the semantic header name.
- Current group-info leave control is a role button with `data-testid="li-delete-group"` and text «Вийти з групи»; once the semantic header opens the correct drawer, the existing exact leave/confirmation path can operate fail-closed.

## 2026-09-25 autonomous Discovery outcome-loop correction

- Після live UX перевірки уточнено product intent: число в полі «Нових цільових чатів» — це goal фактично кваліфікованих target chats, а не кількість сирих invite у local preview.
- Primary «Запустити автопошук» тепер запускає explicit autonomous run. Paired executor має task-first source advancement, auto-handoff, factual WhatsApp join/pending/qualification, auto-archive до вступу та verified leave/archive після вступу.
- Manual Telegram/local preview лишається recovery path і не пише в D1 без confirm; локальні preview, що вже є на момент старту autonomous run, можуть бути автоматично adopted у цей run.
- Source advancement використовує targeted dedupe поточного batch і не повертає owner-wide 10k chat scan. Source cadence bounded до 60 секунд, а без active run додатковий source advance не виконується.
- Physical staging acceptance цього нового outcome-loop ще не заявляється: потрібно прогнати реальні invites до target/reject і підтвердити goal continuation / sources_exhausted.

## 2026-09-25 P4-A WhatsApp Discovery GO-LIVE evidence

- GO-LIVE-01 is accepted: canonical staging build `1abb3289999c5f0feaf58bfa502e776b077ab7fe` matched remote `main`, Opera exposed local CDP on `127.0.0.1:9222`, authenticated WhatsApp Web was present, and the canonical Discovery runner paired by reading its executor token from the staging Work OS page.
- GO-LIVE-02 remains open. A real confirmed persisted candidate (`EIGS1EMXVbSJxR7HgeZUXy`) reached the exact WhatsApp invite through the executor. WhatsApp factually returned «Не вдалося приєднатися до цієї групи. Повторіть спробу пізніше.»; direct runtime observation completed in about 23s and returned `whatsapp_join_retry_later` with `targetVerified=true`. No joined/pending state was fabricated.
- The previous 20s adapter deadline could expire before that factual modal appeared, surfacing `target_not_verified`. Commit `d62734136fee5615ccfdd4655232e84529503514` is the corrected timeout change: WhatsApp invite resolution now has a 45s default, and the module passes `node --check` plus a real ESM import smoke. Qualification criteria, D1 schema and fail-closed semantics are unchanged.
- Next acceptance blocker is external/runtime factual outcome: a confirmed real invite must actually reach `joined` or `pending`; retry-later remains retryable and cannot close GO-LIVE-02.

# Development status — 2026-09-24

## 2026-09-24 locale-aware WhatsApp activity dates / v0.2.72

- WhatsApp Web snapshots now include the factual browser `navigator.language`.
- Ambiguous numeric dates where both first fields are ≤12 use `Intl.DateTimeFormat(locale).formatToParts()` to determine day/month order. Unambiguous dates still work without locale.
- Missing/invalid/unsupported locale leaves an ambiguous timestamp unknown instead of choosing the later interpretation and risking false activity.
- This preserves the existing ≤72h active / ≥14d dead thresholds while making the evidence source fail-closed. No D1 schema or production operation changed.


## 2026-09-24 WhatsApp activity timestamp correctness / v0.2.71

- Visible WhatsApp message metadata now parses year-first `YYYY-MM-DD` / `YYYY.MM.DD` / `YYYY/MM/DD` separately before ambiguous day/month formats, preventing a partial match inside a four-digit year.
- Day/month and month/day formats still use the conservative valid-candidate rule and only accept timestamps no later than one day beyond the observed clock.
- Invalid calendar dates are rejected by component round-trip validation instead of JavaScript date normalization.
- The existing activity thresholds remain unchanged: ≤72h = active, ≥14d = dead, middle/unknown evidence = unknown. No D1 schema or production operation changed.


## 2026-09-24 broader factual WhatsApp ad evidence / v0.2.70

- WhatsApp Web ad-like message evidence now covers common UA/RU/EN marketplace, give-away, exchange, wanted, services, work, rent and transport wording instead of a narrow handful of stems.
- The decision threshold did not change: `inferred_allowed` still requires factual recent activity plus at least two visible ad-like messages.
- A single ad-like message, missing/recent-activity evidence, or any explicit ad prohibition cannot become `inferred_allowed`; explicit prohibition still wins.
- This reduces false `unknown_ads_allowed` reviews without turning normal conversation into permission evidence. No D1 schema or production operation changed.


## 2026-09-24 factual compact WhatsApp member counts / v0.2.69

- WhatsApp Web factual qualification now parses localized compact counts such as `1.2K members`, `1,2K participants`, `1,2 тис. учасників` and `1.2 тыс. участников`.
- Compact conversion is accepted only when the number is directly tied to a recognized member/participant label; unrelated counts such as views remain unknown.
- Existing full integer formats remain supported and canonical target thresholds stay 700–18,000.
- This reduces false `unknown_member_count` reviews without inferring a count from unrelated UI text. No D1 schema or production operation changed.


## 2026-09-24 factual WhatsApp topic qualification / v0.2.68

- WhatsApp Web runtime qualification can now emit factual `topicMatch='match'` when the observed group identity (header/info drawer) itself contains a strong Ukrainian/Ukrainians/Ukraine/🇺🇦 signal.
- Generic group names remain `unknown`; source/search provenance is not injected into this runtime decision.
- Existing spam evidence still wins first and emits `mismatch`, so names such as «Українці … crypto signals» cannot be promoted by the Ukrainian token.
- This closes the runtime/manual-source `unknown_topic_match` gap while preserving fail-closed qualification. No D1 schema or production operation changed.


## 2026-09-24 WhatsApp runtime readiness gate / v0.2.67

- A non-interactive executor process without `WORK_OS_WHATSAPP_CDP` exits before the first Work OS API/D1 poll. There is no useful autonomous work it can safely complete in that state.
- Transient WhatsApp runtime failures (`whatsapp_not_authenticated`, `page_not_ready`, local CDP/socket failures) now block new Discovery source advancement for five minutes. Existing messenger tasks remain fail-closed; no callback is invented.
- A factual successful WhatsApp inspect/leave/autopost clears the runtime block immediately. Interactive TTY mode can still use the explicit operator-confirmed fallback.
- The canonical autonomous prompt now preserves the 60s empty-source cadence and runtime-readiness/cooldown rule so later development cannot silently regress the D1 guardrail.
- No schema migration, staging D1 probe or production operation is part of this slice.


## 2026-09-24 active Discovery source budget / v0.2.66

- The executor runner now distinguishes messenger work from source crawling. Real join/inspect/leave/autopost work and a source step that just created candidates keep the 3s handoff cadence; a source step with no new candidate waits 60s before another source crawl.
- A non-interactive runner without `WORK_OS_WHATSAPP_CDP` no longer advances Discovery sources at all. This prevents an unattended process from accumulating join tasks it cannot inspect and from burning D1/search budget toward a goal it cannot confirm.
- One Telegram source advancement is reduced from 2 seed queries / 3 preview channels to 1 seed query / 2 preview channels. Public-web fallback is reduced from 4 to 2 queries per advancement.
- Worst-case continuously active empty-source cadence is therefore capped at 1,440 source advancements/day per runner, with one Telegram seed task per advancement. This is a ceiling, not a target; messenger work, idle backoff, completion and runtime blockers reduce it further.
- D1 budget regression tests now lock source cadence, runtime gating and batch bounds. No schema migration or production operation is involved.


## 2026-09-24 Telegram source diversity / v0.2.65

- Public Telegram source discovery now deduplicates search hits by case-insensitive channel username before spending the per-task preview page budget.
- Multiple post URLs from the same `t.me` / `telegram.me` channel no longer crowd out other channels. The first exact public post/preview URL remains provenance, while the next preview slot is reserved for a different channel.
- Same-channel history follow-up remains compatible with this canonical channel key and still has the +1 non-recursive cap.
- This reduces redundant external fetches and improves source diversity without any D1 schema/polling change.


## 2026-09-24 bounded Telegram history follow-up / v0.2.64

- When a fetched public `t.me/s/<channel>` preview yields no WhatsApp invite, Discovery may follow exactly one same-channel numeric `?before=` history link for that seed task.
- The follow-up is deliberately non-recursive: at most one extra Telegram history fetch per task, only after an empty first preview. A current preview that already yields an invite never paginates.
- Foreign-channel, `after=`, private/internal/service or malformed pagination links are ignored. Candidate provenance records the exact older preview URL when it supplies the invite.
- Worst-case external fan-out for the production autonomous call remains bounded: per task at most 3 search variants + `pageLimit` current previews + 1 older preview. D1 polling/query cadence is unchanged and no schema migration is involved.


## 2026-09-24 Telegram city-alias coverage / v0.2.63

- Telegram seed tasks now retain the seed workbook's native/Latin city name alongside the Ukrainian display name.
- Public Telegram search tries the canonical strict query first, then a strict Latin-city alias when different, and only then the single broader WhatsApp fallback. It exits early as soon as the configured source page limit is filled.
- This improves diaspora queries such as `Ukrainian in Berlin` without changing the deterministic seed cursor, goal accounting or D1 schema. External search remains bounded to at most three search variants per seed task.


## 2026-09-24 Telegram-derived Discovery coverage / v0.2.62

- Autonomous Telegram-derived Discovery keeps the existing deterministic seed cursor, but each seed task now has a strict `chat.whatsapp.com` search and one bounded broader `WhatsApp` fallback only when the strict result does not expose enough Telegram source pages.
- Public `t.me/<channel>` and `telegram.me/<channel>` results are converted to `t.me/s/<channel>` history previews before fetch, preserving a numeric message tail and bounded `before/after` cursor when present. This lets source inspection see the public channel history instead of only the landing card.
- Private `t.me/+`, joinchat, internal `/c/` and Telegram service links are never converted into crawl targets. Fetch volume remains bounded by two search variants and the existing per-task pageLimit.
- Candidate provenance remains the exact fetched Telegram preview URL plus the canonical seed query. No D1 schema or production operation changed.


## 2026-09-24 remaining D1 poller hardening / v0.2.61

- Workday cross-device sync no longer issues a D1-backed GET every 5 seconds forever. The local elapsed-time clock still updates every second without network access, while server polling uses 5s active → 15s → 30s → 60s unchanged backoff and up to 5 minutes after repeated failures.
- An unchanged visible Workday tab therefore settles at at most 1,440 GETs/day instead of 17,280; hidden/offline tabs do not poll. Focus, online and BroadcastChannel events still wake sync immediately.
- Viber safe-mode no longer polls the broad messenger-automation state every 2 seconds. It reads only its exact owner-scoped job ID and backs off 5s → 10s → 20s → 40s → 60s, with the same 5-minute error ceiling and visibility/online gate.
- An indefinitely pending visible Viber safe-mode job settles at at most 1,440 targeted GETs/day instead of 43,200 broad GETs/day. The route no longer reads the unrelated latest WhatsApp job for this status check.
- D1 budget regression coverage now includes both paths. No schema migration, production read or production write is involved.


## 2026-09-24 quota recovery surface / v0.2.60

- The root server render now recognizes Cloudflare D1 free-tier daily row-read exhaustion and renders a first-party recovery surface instead of falling through to the generic browser «This page couldn't load» error.
- Recovery copy states that data is not deleted/corrupted and deliberately offers no retry loop/button that would encourage repeated D1 probes.
- Unknown/non-quota server errors are still rethrown; the fallback does not mask unrelated defects.
- This is code-only and adds no migration or production operation.


## 2026-09-24 D1 budget incident hardening / v0.2.59

- Global server revision sync keeps a 10s active path after activity/change, then backs off to 30s and 60s while unchanged. Repeated sync/server failures back off up to 5 minutes instead of retrying D1 every 10 seconds.
- Platforms keeps exact-view cache but no longer speculatively prefetches sibling queues. D1-backed queues load only when requested.
- Discovery quota guards remain mandatory: 15→30→60s runner idle backoff, one executor heartbeat write per 60s/device, no task-limit multiplication, and no remote migration-list read for fingerprint-proven code-only deploys.
- `tests/d1-budget-contract.test.mjs` prevents regression of the above budget rules.
- WhatsApp now shares the Viber expandable «Приєднані сьогодні» block and uses the existing WhatsApp Web open path.
- Canonical autonomous-development instructions now live in `docs/AUTONOMOUS_DEVELOPMENT_PROMPT.md`.
- Production Worker/D1 are untouched.


## 2026-09-24 D1 quota hardening for executor polling

- The desktop Discovery runner no longer polls the D1-backed executor stack every 3 seconds while idle. It now uses adaptive 15s → 30s → 60s idle backoff and returns to 3s only after real work is completed.
- Transient WhatsApp/CDP unavailability is treated as idle instead of a successful iteration, so a missing browser adapter cannot create a tight retry loop.
- Executor authentication still validates every bearer token request, but `last_seen_at` heartbeat writes are throttled to at most once per 60 seconds per device instead of writing on every poll.
- No schema migration is required, so this hardening can deploy while staging D1 is read-quota exhausted. Production remains untouched.


## 2026-09-24 Migration-fingerprint quota fallback

- Repeated staging retries showed that D1 quota handling should not depend on GitHub Compare or local git history inside Workers Builds.
- The build now embeds a deterministic fingerprint of all `migrations/*.sql` into `/api/build`. On a D1 daily row-read quota failure, deploy compares the current local migration fingerprint to the fingerprint advertised by deployed staging.
- The currently deployed pre-fingerprint baseline `8a6a06c...` is pinned to the exact migration fingerprint independently verified from its Git tree. GitHub comparison confirmed there are zero migration changes from that deployed build to current main.
- Any changed/added/removed migration changes the fingerprint and blocks the quota fallback. After this release deploys, future staging builds advertise the fingerprint directly, so the one-time baseline is no longer needed for normal comparison.
- Production remains untouched.

## 2026-09-24 Quota fallback uses local git comparison

- The first quota-safe fallback depended on GitHub REST Compare and a Cloudflare build failed with `commit_comparison_unreachable` even though the repository had already cloned successfully.
- The deploy guard now compares the exact deployed staging `/api/build` SHA to current HEAD using the local Cloudflare build checkout (`git merge-base` + `git diff --name-only`). If the deployed commit is absent from a shallow clone, it fetches only that commit from `origin` and retries locally.
- No GitHub REST Compare API is required. Any migration delta, non-ancestor staging SHA, missing commit, failed fetch or failed git diff still fails closed. Production remains untouched.

## 2026-09-24 Quota-safe staging code-only deploy fallback

- Cloudflare Workers Build for v0.2.58 completed the application build but staging deploy was blocked because the staging D1 free-tier daily row-read quota was exhausted while Wrangler tried to list migrations.
- `deploy-staging.mjs` now recognizes that specific quota failure and may bypass only the migration-list read when it can independently prove the release is code-only since the exact currently deployed staging `/api/build` SHA.
- The proof compares the deployed staging build SHA to the current build through GitHub and refuses fallback if any `migrations/*.sql` file changed, if staging identity is unavailable/invalid, or if the deployed SHA is not an ancestor. Production remains untouched.

## 2026-09-24 Viber joined-today expandable panel — v0.2.58

- Viber now has a compact expandable «Приєднані сьогодні» panel directly below the queue/quick-mode controls and above the main chat toolbar.
- The panel uses the canonical `joinedToday` data already returned by `/api/chats`; opening it shows current chat names/links and lets the operator open each Viber chat directly.
- `joinedTodayStatement` now counts only chats that are still genuinely joined in the working flow (`waiting` or `ready` with `joined_at`). Archived, failed and returned-to-join chats drop out immediately instead of remaining in the daily joined list.
- The panel is responsive: multi-column on wider workspace widths and one-column with bounded scrolling on narrow/mobile layouts.

## 2026-09-24 WhatsApp batch confirmed-send autopost — v0.2.57

- WhatsApp ready queue now has «Автопост черги»: one operator action queues up to 30 currently eligible chats instead of opening each row separately.
- Batch selection excludes already published chats, snoozed/non-ready chats, active chat/day jobs and Discovery candidates that are not target. Per-chat creation still rechecks canonical publication/profile/material rules, so one ineligible chat is skipped without failing the rest of the batch.
- Active pending/claimed WhatsApp jobs are now reservations in same-day advertisement selection. As long as unused eligible Library materials exist, queued jobs receive different materials instead of all snapshotting the same first-ranked advertisement before any send completes.
- Executor claim excludes the job's own reservation while still respecting reservations of sibling jobs, so a valid queued job does not invalidate itself.
- The existing exact-target, 90-second lease, confirmed-send DOM evidence, chat mutation fence and fact-first publication accounting remain unchanged per job.
- The parallel v0.2.56 direct WhatsApp Web invite-opening fix is preserved; batch work is layered on top of canonical main.
- No new external send is claimed by this source release; live WhatsApp Web/CDP acceptance remains separate. Image/media automation remains the next functional slice.

## 2026-09-24 Direct WhatsApp Web invite opening — v0.2.56

- Platform chat links no longer open the generic `chat.whatsapp.com` landing page. Work OS extracts the exact invite code and opens `https://web.whatsapp.com/accept?code=...` in a new browser tab.
- This keeps the operator inside WhatsApp Web and avoids the intermediate browser prompt that tries to hand the invite to the desktop application.
- Viber/Telegram/Facebook opening behavior is unchanged. Production is untouched.

## 2026-09-24 WhatsApp confirmed-send text autopost — v0.2.55

- Ready WhatsApp chats now expose a bounded «Автопост» action. Work OS automatically selects an eligible Library advertisement/language and creates an owner-scoped, idempotent job instead of marking publication optimistically.
- The job snapshots exact chat identity, chat state, material version/text and Europe/Kyiv publication date. Claim rechecks ready/target state, current material, profile eligibility and same-day reuse immediately before any external send.
- The existing paired browser runner claims WhatsApp autopost only when no Discovery messenger task is due. CDP verifies the exact joined target and writable composer, inserts the exact text, sends it, then requires a newly visible outbound message DOM id with exact text plus cleared composer before returning `sendConfirmed=true`.
- Wrong target, admin-only/read-only, missing composer, ambiguous DOM or unconfirmed send fail closed. Authentication/CDP outages send no false failure callback and the bounded lease can be retried.
- Canonical publication accounting is created only after confirmed send with source `whatsapp_autopost`. Manual publish is blocked while the job is active; chat/day uniqueness protects retries. After a factual send, accounting is fact-first and is not discarded because Library/profile policy changed after claim.
- The UI shows «Автопост у черзі». Pending jobs can be cancelled; an unexpired claimed job cannot be cancelled because a send may already be in flight, and it becomes cancellable again after lease expiry. Chat mutations/return-to-join are server-blocked while the job is active.
- Migration `0038_whatsapp_autopost_jobs.sql` is staging-only through the normal guarded migration pipeline. Production remains untouched.
- This release is text-only. Batch queue autopost and canonical advertisement image/media support remain the next functional slices; live WhatsApp browser acceptance is still separate evidence.

## 2026-09-24 WhatsApp factual post-join qualification — v0.2.54

- WhatsApp exact-target verification now uses the exact invite code as identity on the invite screen, so an approximate or generated source name can be safely replaced by the observed WhatsApp group name before later header matching.
- Joined inspection enriches the callback with factual qualification evidence from the verified chat: member count from group info, composer/admin-only writeability, explicit ad rules, recent repeated ad-like message evidence, obvious spam/topic mismatch and visible message timestamps.
- Activity is conservative: <=72h latest-message evidence is `active`; >=14d is `dead`; the middle/unknown case stays `review`. Missing DOM evidence never invents `dead` or `target`.
- `inferred_allowed` is accepted only when the adapter observed recent activity plus at least two ad-like visible messages and no explicit ad prohibition. Explicit forbidden rules, admin-only, spam/topic mismatch, dead activity and member-threshold failures become canonical rejection facts and therefore flow into the existing verified leave/archive path after join.
- Joined `review` candidates keep the 10-minute bounded reinspection cadence. Target-count reconciliation now receives the candidate's `discovery_run_id`; a late target can update a run even after source exhaustion.
- Live WhatsApp browser acceptance is still external evidence and is not claimed while the Browser Connector/CDP session is unavailable.

## 2026-09-24 Goal-driven autonomous WhatsApp Discovery core — v0.2.53

- Discovery is redefined around operator outcome rather than raw link yield. The default run goal is 50 new confirmed target chats; raw candidates/imports do not complete a run.
- A candidate is associated with the run that first discovered it. `target_count` therefore counts only new targets from that run. Completion is explicit: `goal_reached` or `sources_exhausted`.
- The paired executor advances the source plan whenever no messenger action is due. It walks the existing seed corpus automatically: public Telegram/t.me-derived search first, then bounded public-web fallback. A source lease in D1 prevents paired executors from advancing the same run concurrently.
- New WhatsApp candidates continue to auto-handoff into `to_join`. Previously known chats/candidates, including archived/rejected/unavailable history, remain deduplicated and are not auto-joined again in later runs.
- The primary UI is one-click: target count + «Запустити автопошук». Manual Telegram paste/query controls remain only inside a collapsed recovery section.
- Pending WhatsApp remains on its 3-minute factual recheck. Joined candidates that still lack qualification facts receive a bounded 10-minute reinspection cadence instead of a tight runner loop.
- Migration `0037_autonomous_discovery_goal.sql` adds run target/completion/source-lease state plus first-run candidate attribution. Production is untouched. Post-join factual qualification is the next functional slice before this workflow is fully unattended end-to-end.

## 2026-09-24 Automatic WhatsApp Discovery handoff — v0.2.52

- Newly discovered WhatsApp invites that already passed the existing public/Telegram prefilter are automatically handed off into the canonical `to_join` chat workflow after persistence. The operator no longer has to press «Додати на перевірку» for every new WhatsApp candidate.
- Auto-handoff is WhatsApp-only. Viber remains manual/native-safe, and existing/raced candidates preserve the existing idempotent handoff behavior.
- The created chat immediately becomes an executor `join_and_inspect` task. If the invite is factually invalid/unavailable before join, canonical inspection archives that chat without claiming a join or external leave.
- This is a functional lifecycle step, not a background acceptance-only change. Live WhatsApp browser execution remains separate evidence.

## 2026-09-24 WhatsApp bounded pending recheck — v0.2.51

- WhatsApp pending approval now has a canonical server-side cadence instead of being reissued to the runner every polling cycle.
- A factual `pending` inspection stores `executor_next_check_at = now + 180s`; executor queue excludes that candidate until the due time, then automatically exposes `check_membership_and_inspect` again.
- The due time lives in D1, so runner restarts and multiple paired devices share the same schedule. Joined/unavailable/other inspection outcomes clear the pending cadence on the next canonical inspection update.
- Migration `0036_chat_discovery_pending_recheck.sql` adds only the staging-safe timestamp/index. Production is untouched. Live WhatsApp browser acceptance remains separate evidence.

## 2026-09-24 Verified WhatsApp external leave automation — v0.2.50

- WhatsApp Web executor now handles `leave` tasks through the same optional loopback-only CDP path as join/check instead of always stopping for manual confirmation.
- The runner first reopens the exact invite, reaches the exact joined chat, verifies the rendered target, opens its info surface, finds the localized leave control, confirms the leave dialog and waits for factual post-leave UI evidence before posting `executor-leave` to Work OS.
- Wrong/unknown target, missing controls, unauthenticated browser, disappeared controls or missing post-leave confirmation all stop fail-closed with no callback. Non-interactive runners never fall back to guessing; interactive runner keeps the existing manual confirmation fallback.
- This closes a real lifecycle action for joined rejected/unavailable WhatsApp chats. Live browser acceptance still depends on an available authorized browser/CDP session and is not inferred from source code.

## 2026-09-24 Functional-value reprioritization

- Поточний P4 більше не трактується як acceptance-first етап. Значний reliability/UX baseline уже існує, але він не є заміною відсутнього operator workflow.
- Активний порядок: реальний WhatsApp Web executor → pending approval automation → повний Chat Discovery lifecycle → bounded confirmed-send WhatsApp autopost.
- Publication consistency, exact-target verification, leases/fencing, loading contract і D1 source-of-truth лишаються обов'язковими gates усередині кожного functional slice.
- Physical Safari, exhaustive a11y, broad cross-device/offline matrices переносяться після functional backlog або виконуються раніше лише коли реально блокують поточну функцію.
- Manual workflows не видаляються: вони лишаються recovery/fallback. AI generation лишається P6. Viber real-chat autopost лишається забороненим до окремого прямого дозволу.
- Це зміна пріоритетів/документації, не окремий user-facing release; APP_VERSION не піднімається.

## 2026-09-24 WhatsApp executor lease fencing — v0.2.49

- Discovery executor claim/reclaim now advances the candidate version and returns that claimed version as the task fencing token.
- Executor inspection callbacks carry the authenticated device into the domain. Join/pending/archive transitions use an optional SQL fence requiring the exact candidate, claimed version, device and unexpired lease; ordinary manual chat transitions remain unchanged.
- Final inspection persistence also rechecks the executor device and lease. A reclaimed task therefore cannot mutate candidate qualification or linked chat workflow through a stale runner callback.
- Regression coverage verifies that a second device can reclaim after lease expiry and the first device's old join callback leaves the chat in `to_join`.
- Live WhatsApp Web acceptance is still a separate gate; no external messenger action is claimed by this source slice. Full local lint/typecheck/full-tests are not inferred from source contracts.

## 2026-09-24 Publication concurrent-write regression gate

- Publication consistency coverage now includes two simultaneous manual publication attempts against the same canonical chat state/day, not only sequential retry.
- The expected invariant is explicit: exactly one domain call succeeds, one fails closed, and D1 contains one publication row plus one active publication event. Today/Reports, Analytics and Library reuse all still read one fact.
- This strengthens source-level evidence for double-click/race safety without changing the publication domain or adding a second read model.
- Full local lint/typecheck/full-tests/build and live two-device/offline acceptance remain separate evidence gates; this entry does not claim them.

## 2026-09-24 Viber safe-mode lease completion hardening — v0.2.48

- Viber «Мої нотатки» safe-mode already has the complete source path: Library material → owner-scoped idempotent job → leased executor task → exact `my_notes` verification → confirmed send callback, with zero publication/accounting facts.
- Completion now repeats the lease-expiry guard inside the final conditional UPDATE. A callback that loses its lease between the preliminary read and the write cannot commit `sent` or `failed`; it returns conflict and leaves the job reclaimable/inspectable.
- Regression coverage includes an expiry-boundary callback and reasserts that neither `chat_publications` nor publication activity events are created by the smoke flow.
- This closes the remaining source-level Viber safe-mode reliability gap. Native Viber physical acceptance remains a separate gate; Remote Desktop Commander is not used for native Viber.
- Full local lint/typecheck/full-tests/build and canonical staging `/api/build` identity are recorded separately and are not inferred from source contracts.

## 2026-09-24 Bilingual advertisement save invariant — v0.2.47

- Advertisement create/update now requires non-empty UA and RU text in the Library API. Scripts and knowledge entries retain the previous at-least-one-language rule.
- Library mirrors the server invariant: both advertisement fields are labeled required and Save stays disabled until UA+RU and platform selection are complete.
- Legacy one-language advertisements are preserved rather than rewritten or deleted. List/editor copy identifies the missing language and requires repair only when a new version is saved.
- This closes the forward-write invariant for AD-02 without pretending historical data was migrated. AD-02 remains partial until legacy items are explicitly reconciled and live responsive acceptance is complete.
- Source regression coverage was updated for the bilingual API/UI contract. Full local lint/typecheck/full-tests are not inferred from source contracts.
- WhatsApp Web live executor acceptance remains blocked by the unavailable Opera Browser Connector/CDP endpoint; no messenger callback was executed.


## 2026-09-24 Confirmed-profile normal publication gate — v0.2.46

- Ordinary publication now requires a confirmed profile in the publication domain and again in the atomic INSERT. A stale/direct request cannot create a publication fact after the profile becomes draft/missing.
- WhatsApp/Viber quick publication remains the explicit exception for urgent manual work. It still requires a material, preserves draft/missing profile state and keeps the chat in profile clarification.
- In Platforms, a draft/missing ready chat opens profile editing as the primary normal-mode action; when quick mode is intentionally enabled, the primary action returns to publication preparation.
- `availableToday` now represents normal publication readiness: confirmed profile plus existing cadence/day/next-date, snooze, qualification and account constraints. Legacy confirmed profiles with nullable cadence/weekdays use canonical permissive defaults instead of disappearing.
- Existing publication/Undo regression fixtures were updated to declare confirmed-profile preconditions explicitly, plus focused ordinary-vs-quick and legacy-profile coverage. Full local lint/typecheck/full-tests and physical Safari/live UX acceptance are not inferred from source contracts.
- WhatsApp Web live executor acceptance remains blocked by the unavailable Opera Browser Connector/CDP endpoint; no messenger callback was executed.


## 2026-09-24 Analytics exact-range decision overview — v0.2.45

- The decision-first Analytics overview now consumes the exact active analytics query. Day/week/month/year/custom changes therefore update plan/change/bottleneck evidence to the same period as the four canonical metrics.
- Historical plan/fact uses the monthly goal effective at the range end and counts month activity only through that date; later events in the same month cannot leak into an older snapshot.
- Comparison uses the immediately preceding equal-length period. Chat recommendation sampling uses the selected range rather than an unrelated current-month window.
- Analytics workspace and overview both use exact-query cache identity. A period transition may show that exact view's cache or a stable loader, never stale values from the previous period.
- Focused regression coverage protects range propagation, historical isolation and exact-view loading contracts. Full local lint/typecheck/full-tests and physical Safari/live UX acceptance are not inferred from source contracts.
- WhatsApp Web live executor acceptance remains blocked by the unavailable Opera Browser Connector/CDP endpoint; no messenger callback was executed.


## 2026-09-24 Profile clarification queue — v0.2.44

- Platforms now has a dedicated «Уточнити профіль» queue. It is a virtual server view over canonical `waiting` + `ready` chats with draft/missing profiles; no workflow state is duplicated or rewritten just to populate the queue.
- Each row exposes its real underlying workflow as «Очікування» or «Для публікації». The primary action is profile editing, while quick-publish and join actions remain in their canonical queues.
- The aggregate queue count is derived from the existing per-workflow profile counts. Confirming a profile invalidates/reconciles the Platforms cache, so the row leaves the clarification queue without F5.
- Five queue tabs remain container-responsive: desktop uses five columns, narrow containers wrap to three columns, and mobile keeps the horizontal 48px touch-friendly tab strip.
- Added focused source regression coverage for the virtual server filter, combined count, queue semantics and responsive tab layout. Full local lint/typecheck/tests and live Safari/physical acceptance are recorded separately and are not inferred from source contracts.
- The WhatsApp Web CDP adapter remains source-complete but live browser acceptance is still blocked by the unavailable Opera Browser Connector/CDP endpoint; no external messenger callback is claimed.


## Unreleased — WhatsApp Web CDP executor adapter

- Chat Discovery's reference runner now supports an optional `WORK_OS_WHATSAPP_CDP` endpoint for an already-authorized Chromium/Opera profile. It converts `chat.whatsapp.com` invites to WhatsApp Web, verifies the exact rendered target before any join/request click, and reports only factual joined/pending/inaccessible states.
- Target mismatch, generated placeholder name, unauthenticated browser, missing/changed controls and ambiguous membership all fail closed. Known-unavailable text is trusted only while the browser URL still carries the exact expected invite code, preventing stale/global WhatsApp DOM from rejecting another candidate. No executor callback is sent from the automated path in those cases; an interactive runner may fall back to the existing operator-confirmed flow.
- CDP control is accepted only on unauthenticated loopback HTTP/WebSocket endpoints (`localhost`, `127.0.0.1`, `::1`); remote/LAN debuggers fail closed before the task URL is navigated.
- The adapter does not infer topic fit, ad permission or activity from weak DOM signals. Writeability is reported only when the exact chat header is verified and the composer/admin-only state is factual.
- Regression coverage was added for invite conversion, exact-target verification, join gating, pending/joined states, exact-invite-scoped invalid-link handling, verified `Continue to Chat`, and the runner's no-callback ambiguous-state path.
- Live browser acceptance is still open: Opera is running on the authorized CachyOS device, but Browser Connector is disabled and the current browser process exposes no CDP endpoint. No live WhatsApp action/callback is claimed by this source slice.
- DATA-06 remains intentionally gated by ROADMAP; the premature IndexedDB outbox experiment was reverted in `16a9c785` before this work continued.


## 2026-09-23 Joined-today correction on archive — v0.2.34

- Archiving an unusable chat now cancels its active same-day `chat_joined` fact. This removes the chat from «Приєднано сьогодні» and from joined analytics/counts while preserving the audit row as a cancelled event.
- WhatsApp `return_to_join` and failed join cleanup follow the same rule. A plain restore does not make the chat count as joined again; only a subsequent successful join/approval reactivates or creates the active same-day fact.
- Cancellation is guarded by the successful state-transition event, so a stale/failed archive request cannot erase a valid joined fact. Regression tests cover archive → restore → rejoin, legacy joins, Telegram account attribution and stale archive protection.

## 2026-09-23 Platforms no-remount reconciliation — v0.2.33

- Root cause of the remaining queue flash was the shell keying `PlatformWorkspace` by `syncRevision`: every local `router.refresh()` or server-sync revision update remounted the whole workspace, resetting chat data to null and showing the large loader even though the mutation itself had already completed.
- Platforms is now kept mounted across revision changes. `syncRevision` is passed as data, and the workspace silently re-fetches canonical chats/accounts when that revision changes instead of resetting all local UI state.
- Direct Platforms mutations no longer call `router.refresh()`; archive/publication/profile/account reconciliation uses silent client-side reloads. Cross-device server sync still updates the page shell, but Platforms consumes the new revision without remounting.
- Regression coverage now forbids the revision key and router refresh inside Platforms, and requires the silent reconciliation path.

## 2026-09-23 Platforms background reconciliation — v0.2.32

- Chat mutations in Platforms no longer clear the currently loaded queue before the authoritative GET reconciliation finishes. Archive, manual publication and other same-view actions therefore keep the list mounted instead of replacing the whole block with a loading screen.
- Full loading UI is now reserved for the initial load or an actual request-key switch (platform/queue/search/page/account). Same-view refreshes keep the current rows visible while controls remain guarded by the existing busy state.
- The same non-blanking behavior now applies after profile save and same-view bulk/discovery additions. A regression contract protects the load path from reintroducing `setData(null)` and verifies the loader only replaces the list when no current data exists.

## 2026-09-23 Platforms container-responsive queue — v0.2.31

- Platforms queue layout now reacts to the actual width of the `.platform-browser` container instead of relying only on viewport breakpoints. This fixes the sidebar/tiled-window case where the browser viewport was still wide but the working list itself was narrow.
- The scrollable chat grid now uses max-content auto rows and owns the remaining flex height, so wrapped action controls increase their row height instead of visually spilling into the next chat.
- At compact container widths chat actions stack safely below chat identity, names/badges may wrap, and the four queue tabs become a two-column grid. Regression contracts cover the container breakpoint, row sizing and scroll-region behavior.

## 2026-09-23 Platforms archive dialog reliability — v0.2.30

- Replaced the inline archive-reason strip with a dedicated modal dialog. The previous strip could visually overlap the next chat row in the dense Platforms list, leaving its reason controls partially covered and effectively unclickable.
- Preset and custom archive reasons now run through the same guarded archive mutation while the dialog stays open on failure. Stale-state errors remain visible in the dialog; the canonical list reload still refreshes the state token before a retry.
- Added a regression contract that forbids returning the archive reason picker to the row layout. This is source-level evidence; staging browser smoke remains the live acceptance step.

## 2026-09-23 Platforms narrow-desktop responsiveness — v0.2.29

- Platforms chat queues now switch to a single-column row composition at <=1180px: chat identity stays full-width and action buttons wrap below it instead of forcing horizontal overflow.
- The queue toolbar also wraps at the same breakpoint: search gets its own full-width row, while profile counts and secondary controls can wrap without collapsing the input to an icon-width fragment.
- Native links are capped to the available row width and the main/action columns explicitly allow shrinking. A regression contract protects the narrow-desktop breakpoint; mobile <=720px behavior remains unchanged.

## 2026-09-23 Chat Discovery local executor companion — v0.2.27

- Added a dependency-free local runner command that consumes the paired bearer-authenticated executor queue, opens the exact WhatsApp/Viber invite with the OS browser, and submits inspection through the existing version/lease guards.
- External actions remain operator-confirmed: the runner never claims join/inspection facts it did not receive from the operator, and external leave callback is sent only after an explicit post-action confirmation.
- This closes the executable local transport/feedback loop without pretending DOM automation is reliable. Fully automated messenger adapters and live messenger acceptance remain a separate gap.


## 2026-09-23 Chat Discovery executor task leasing — v0.2.26

- Dedicated executor queue reads now atomically lease each candidate to one authenticated device for 90 seconds, preventing two paired runners from executing the same messenger action concurrently.
- Inspection and external-leave callbacks fail closed unless the candidate is still leased to that exact device and version; expired work is recoverable by another runner instead of remaining stuck indefinitely.
- Revoking an executor immediately releases its outstanding candidate leases. Migration `0035_chat_discovery_executor_leases.sql` adds only staging-safe lease metadata/indexes; production is untouched.
- Focused lease/auth/route evidence is green. Real WhatsApp/Viber browser automation and live messenger acceptance remain the next Discovery slice; this release closes the multi-runner delivery race before that adapter is attached.


## 2026-09-23 Chat Discovery executor pairing — v0.2.25

- Added owner-scoped executor device pairing with one-time 256-bit bearer tokens; Work OS stores only SHA-256 token hashes and supports explicit revocation.
- Added a dedicated bearer-authenticated `/api/chat-discovery/executor` bridge for queue reads plus guarded inspection/leave result callbacks, so an external runner no longer needs a browser session cookie.
- Discovery UI now shows connected executors, last-seen state, one-time token copy and revocation in the existing responsive modal.
- Migration `0034_chat_discovery_executor_devices.sql` is staging-safe and does not touch production. Real WhatsApp/Viber browser automation remains the next runner-adapter slice; this release provides the secure pairing/transport boundary it requires.


## 2026-09-23 dialog close transition hardening — v0.2.24

- Shared Base UI dialogs now deduplicate identical open/close transitions before forwarding `onOpenChange`, preventing a single close gesture from triggering parent close logic twice.
- Controlled dialog state is synchronized back into the guard, so external reopen/close changes remain authoritative while X, Escape and backdrop dismissal share one transition path.
- A UX regression contract protects the shared guard; this package does not claim physical Safari acceptance or change any production data.


## 2026-09-23 Chat Discovery executor contract + Viber leave parity — v0.2.23

- Chat Discovery now exposes an authenticated, owner-scoped executor queue for imported WhatsApp/Viber candidates. Each task includes candidate version and canonical chat state token and names exactly one next external action: join+inspect, membership check+inspect, inspect, or leave.
- External results remain fail-closed: inspection continues through the existing optimistic inspection domain, while a confirmed WhatsApp/Viber leave callback verifies candidate version + chat token, archives the rejected/unavailable chat if needed, then records `confirm_leave` through the canonical leave domain. Work OS still never claims a messenger action happened before the executor reports success.
- Viber now shares the same recoverable archive leave-checklist policy as Telegram/WhatsApp, including permanent-delete protection until leave is confirmed. Platforms, leave domain and deletion domain read the same policy helper instead of maintaining divergent platform lists.
- Focused evidence is green: executor tests 3/3; leave/permanent-delete tests 9/9; typecheck and `git diff --check` pass. The full `npm run verify:local` release gate is recorded separately after the final snapshot. The remaining Discovery gap is the actual external runner/pairing and live messenger acceptance, not another source-of-truth state machine.

## 2026-09-23 manual publication retry recovery — v0.2.22

- Platforms chat mutations now return a typed action result instead of collapsing every failure to a boolean. Manual publication keeps the exact server error inside the publish dialog, so cadence, duplicate, network and validation failures no longer degrade to a generic retry message.
- A server `refresh:true` stale-state response is treated as authoritative recovery: the list is reloaded, the stale publish dialog closes, and the operator gets an explicit instruction to reopen the current chat instead of retrying with the old `stateToken`.
- Other 409/domain failures keep the dialog open with the real server explanation; unrelated chat actions retain the existing workspace-level error surface. Regression contracts cover the split error/recovery behavior.
- PUB-01/PUB-15 and QA-09 remain partial until the live/two-device/network acceptance matrix is completed; this package closes a source-level retry loop, not the physical-device gate.

## 2026-09-23 publication Undo deadline parity — v0.2.21

- Manual publication domain/API now returns the authoritative server-side Undo deadline. Platforms binds the Undo affordance lifetime to that deadline instead of starting a fresh client-only 8-second timer after the network round trip.
- This closes the misleading retry edge where a slow response could leave a visible «Скасувати» button after the domain window had already expired. Server enforcement remains fail-closed and unchanged.
- Regression contracts cover the API deadline and deadline-bound UI timer. Live/two-device publication acceptance remains a separate PUB-15 gate.


## 2026-09-23 Telegram account-context race hardening — v0.2.20

- Platforms більше не викликає chat reload, захоплений для попереднього Telegram account ID, одразу після `select`: новий account ID змінює request key, а canonical load effect завантажує саме новий контекст. Це прибирає короткий stale-account flash/race у publication workspace.
- Додано regression contract на account-switch path; PUB-15 лишається partial до two-device/live acceptance, без штучного підвищення статусу.


## 2026-09-23 Linux continuity and operator UX hardening — v0.2.19

- Resumed the interrupted Linux/main-only cycle from its existing working tree instead of restarting or creating another branch/clone.
- Discovery inspection labels are now neutral (`Перевірено`) and no longer claim a manual observation was automatic. Disabling the currently selected platform reconciles navigation asynchronously and clears quick-publish material so it cannot leak into another platform context.
- Shared primary actions use the blue primary token with the explicit light foreground token; the stale neutral-button contract was reconciled with the current contrast/one-accent UX requirement. Existing manual-publication Undo contracts were also updated to assert the current rollback metadata/API shape rather than the pre-Undo shape.
- Local release gate is green on the final snapshot: lint 0/0, typecheck, 519/519 tests and production build via `npm run verify:local`. Registry totals are 147 ready, 116 partial, 1 not implemented and 12 deferred out of 276.
- This entry is local/main release evidence only. Canonical staging build/deploy begins after the push to `main`; production and production D1 are not touched by this package.

## 2026-09-21 bounded mutation request bodies - v0.2.14

- OPS-07 payload hardening now uses one streaming `readBoundedText` helper before full body allocation for JSON, CSV, backup/restore, legacy import, Telegram schedule, workday and historical publication mutation requests.
- All mutation routes are protected from direct `request.text/json/arrayBuffer/formData` reads by a source-contract regression; existing same-origin, owner and domain guards remain unchanged.
- Chunked requests without `Content-Length` are stopped at the configured byte limit and return the existing route-specific 413 copy instead of allocating the complete body first.
- Full local verify is green: lint 0/0, typecheck, 476/476 tests and the production build. OPS-07 remains partial until the remaining session/privacy audit and live acceptance are complete; canonical staging deploy is still the release gate for v0.2.14.
- Canonical registry remains 141 ready, 122 partial, 1 not implemented and 12 deferred out of 276.

## 2026-09-21 shared subject vocabulary — v0.2.13

- UX-04 is closed with one shared subject registry for CRM writes/search, chat direction normalization, Library subject tags and Report/Analytics grouping. Common Ukrainian, Russian and English aliases resolve to the same canonical label.
- New recognized subject writes are canonicalized, but unknown/legacy values remain untouched instead of being discarded or force-mapped. Legacy migration continues to preserve the source value; read/search paths bridge old aliases without rewriting historical rows.
- Lead and lesson subject fields expose canonical suggestions through a datalist while still accepting custom values. Library tags canonicalize subject aliases but preserve unrelated operational tags.
- Full local verify passed with 471/471 tests and the production build. Canonical Cloudflare staging is live at exact SHA `ed354f0de1ee471dc624fbfd3ca80ee94e303c23` with v0.2.13; production and production D1 were not changed.
- Canonical registry after this package: 141 ready, 122 partial, 1 not implemented and 12 deferred out of 276.

## 2026-09-21 Report revision heatmap — v0.2.12

- REPORT-14 now uses a bounded four-level blue heatmap for saved report versions: 1, 2, 3 and 4+ revisions. Days without a report stay neutral.
- Draft/submitted state remains visible independently from heat intensity through solid/ring markers; stale submitted reports keep the warning treatment, so the heatmap does not regress the existing calendar status contract.
- Workday/weekend and lesson/lead context continues to come from the owner-scoped calendar context read path. The heat mapping is a pure helper with focused regression coverage, plus a UI contract for the legend and state markers.
- Canonical Cloudflare verify/deploy for the final follow-up `c46e5ee` passed before registry promotion. Production and production D1 were not changed.
- Canonical registry after this package: 140 ready, 123 partial, 1 not implemented and 12 deferred out of 276.


Canonical product scope: [PRODUCT_REQUIREMENTS](PRODUCT_REQUIREMENTS.md).
Next work and acceptance gates: [ROADMAP](ROADMAP.md).

## 2026-09-21 configurable payments and forecast — v0.2.11

- PAY-01..04 are implemented as one owner-scoped Settings flow: monthly or semimonthly salary periods, payout days, base salary, and independent lead/booking/completed-lesson bonus periods, rates and targets.
- Payment facts come from canonical non-cancelled activity events; the calculator does not invent default earnings. Base salary and bonus values are stored as integer cents, with zero-value defaults until the user configures real rules.
- The payment card shows current period, payout date, plan, accrued fact and pace-based end-of-period forecast plus per-metric actual/target/forecast values.
- No new D1 schema is required: `payment_rules` uses the existing owner-scoped `user_settings` store, so this package avoids a deployment migration.
- Focused PAY regression is green at 6/6 with typecheck and full lint green. The Windows migration-format gate also exposed and fixed CRLF-only legacy migration blobs without changing SQL semantics.
- Canonical registry after this package: 139 ready, 124 partial, 1 not implemented and 12 deferred out of 276. The only remaining not-implemented requirement is DATA-06 (offline outbox/replay); other remaining P4 work is partial parity/reliability/physical-device acceptance rather than missing implementation.

## 2026-09-21 CRM message attachments — v0.2.10

- LEAD-23 is implemented as CRM history media, not as a hidden external messenger send. Files attach to an existing saved lead message and remain owner-scoped.
- Supported bounded payloads: images, audio, video, PDF, text and common office files up to 10 MB. Active-content/executable extensions and SVG/HTML are rejected; image download responses use private no-store + nosniff.
- Binary payloads live in dedicated D1 chunk rows, separate from message pagination. Attachment metadata is SHA-256 checked, upload retries are idempotent by attachment id + digest, and writes use the existing lead optimistic version guard.
- Deleting an attachment or soft-deleting its message removes media rows/chunks. Conversation export includes attachment metadata; cloud backup schema 13 includes metadata/chunks and schema 12 remains backward-compatible.
- Focused LEAD-23 gate is green at 31/31 with lint/typecheck green. Registry after LEAD-23: 135 ready, 124 partial, 5 not implemented and 12 deferred out of 276. Remaining not-implemented IDs are PAY-01..04 and DATA-06.
- R2 was probed but is not enabled on the Cloudflare account. No storage/billing product was enabled automatically; the current implementation is self-contained in bounded D1 chunks.
- Staging deploy hardening now prevents the next schema change from producing a predictable red build: after exact `work-os-2-staging` + `work-os-2-staging-db` + database-id guards, pending migrations are applied to staging only, re-listed, and the deploy remains fail-closed if apply/recheck fails. `CLOUDFLARE_ENV=production` remains an immediate refusal; no production migration path was added.
- Migration `0032_lead_message_attachments.sql` was applied explicitly to remote `work-os-2-staging-db`; an immediate `wrangler d1 migrations list ... --remote` recheck returned `No migrations to apply`. Production D1 was not targeted.

## 2026-09-21 factual P4 requirement reconciliation

- Canonical registry was reconciled against current v0.2.9 code and regression evidence instead of carrying forward stale partial labels. Eleven requirements move to ready without inventing new scope: AD-14/16/17, PUB-17/18/19/20, ANALYTICS-11/18/20 and CAL-03.
- Focus selection, focus-plan timestamp/staleness, safe unfinished-plan refresh and WhatsApp/Viber quick publication are protected by explicit contracts plus D1 publication/workday regressions. Ordinary profile publication remains a real separate gap; PROFILE-01 is intentionally not promoted.
- Analytics reconciliation is limited to facts already present in the product: complete lesson outcomes, normalized chat ranking with sample confidence/filters/custom range, and historical daily/monthly plan-fact backed by versioned goals. Analytics information-hierarchy items that still need UX work remain partial.
- Report calendar status is covered by domain regressions for stale/resubmitted reports and an explicit UI filter contract. Focused reconciliation suite is green at 51/51 with lint/typecheck green.
- Registry after this pass: 134 ready, 124 partial, 6 not implemented and 12 deferred out of 276. The remaining not-implemented IDs are LEAD-23, PAY-01..04 and DATA-06. Full local verify and the canonical Cloudflare staging build remain required before this reconciliation is accepted in main.

## 2026-09-21 Chat Discovery post-join lifecycle

- Discovery candidates imported into Work OS now follow the canonical chat transition truth: WhatsApp waiting maps to pending membership; join/approval maps to joined; confirmed leave/undo keeps the candidate membership synchronized without a second source of truth.
- The authenticated discovery API has an owner-scoped optimistic `inspect` action. Observed name, membership, chat type, member count, write permission, ad policy, activity, access and link state are re-evaluated against the target criteria instead of being trusted as a precomputed decision.
- A joined target moves into the normal ready workflow. A joined candidate with unknown facts stays ready but explicitly needs qualification. A joined rejected/unavailable chat stays visible until messenger leave is actually confirmed; Work OS does not pretend an external leave occurred. A known invalid invite before joining may be archived safely.
- Focused discovery/workflow coverage is green, including stale/foreign inspection guards, membership synchronization, target/review/rejected/unavailable outcomes and UI state labels. Full local `npm run verify` is green; canonical Cloudflare staging deploy remains the release gate for v0.2.9.

## 2026-09-20 CRM cancellation, conversation export and metric drill-down reconciliation

- CRM-01 is closed from existing domain and UI evidence: pending curator requests can be created with an accounting date, confirmed into one real lesson, or cancelled with a required reason while preserving history and cancelling only the provisional metric. A dedicated UI/mobile contract now protects the cancellation wiring.
- CRM-04 is closed: lead detail is cursor-paginated, ordinary commands avoid loading conversation history, addressed edits load one message, and the text export streams bounded owner-scoped pages with a version guard. The 205-message export regression verifies 100/100/5 paging, chronological output, deleted/foreign exclusion and fail-closed concurrent change handling.
- ANALYTICS-14 is closed: each top metric exposes its definition, formula, selected period and bounded source-event drill-down. The reader is owner/date scoped and excludes cancelled facts.
- Canonical staging remained healthy on v0.2.6 before this documentation/test reconciliation; no production or remote D1 writes were performed.

## 2026-09-20 historical report → lead date parity

- UX-03 is closed from current implementation plus a dedicated regression contract.
- The report workspace action «Новий лід за дату» passes the selected historical report date into LeadEditor as `defaultResponseDate`; LeadEditor uses that value as the required `responseDate` for a new lead and the report command path creates the lead before navigating to it.
- The contract test protects the button/action wiring, the selected-date handoff and the editor default so this parity cannot silently regress.

## 2026-09-20 CRM and analytics parity reconciliation

- Staging `7b67820` is live and the report reconstruction path now also carries canonical lesson subject, teacher and lesson date into booking detail lines.
- Lead parity review closed the contact-not-studying rule, response cancel/restore, and Today responses/bookings presentation. Domain tests protect the `isStudent=0` booking restriction and response event cancellation semantics; read-only staging smoke confirmed the Today counters/lists and cancel-response action.
- Analytics read-only staging smoke confirmed the four top metrics, full five-step activity funnel, per-platform counts/conversions, separate acquisition cohort, original-source chat attribution note, explainable recommendation and day/week/month/year/custom controls.
- ANALYTICS-01/04/05/16/19 and LEAD-17/39/40/41/42 are promoted to ready from current code, tests and staging evidence. No staging data was mutated for these checks.

## 2026-09-20 historical report reconstruction

- `bbdaf24` adds deterministic report draft reconstruction from activity events for any selected historical date
  that does not yet have a saved report. Existing saved text always wins and is never replaced by regeneration.
- The generated draft groups publications, joined chats, responses and bookings per platform and intentionally
  omits the non-existent `Нові чати` line for Threads.
- Canonical Cloudflare verify/deploy is green and live `/api/build` returns
  `bbdaf24ebf2bc6df119d6a2f9c8a198ae8343907` with v0.2.6.
- Read-only staging smoke selected 14.09.2026 (no report) and confirmed the autogenerated draft and notice,
  then selected 01.09.2026 and confirmed its persisted saved text remained authoritative. No writes were made.
- REPORT-01/02/04/12/13/15 are promoted to ready from code, tests and staging evidence.

## 2026-09-20 report calendar acceptance

- `643de46` adds a separate last-final-submission timestamp to the report editor.
- `9d79737` adds explicit report calendar filters for all / has report / missing / stale / resubmitted.
  Resubmission count is derived from distinct final submission timestamps in version history, so
  ordinary draft edits after a submit do not masquerade as another submission.
- Canonical Cloudflare verify/deploy is green and live `/api/build` returns
  `9d79737e4d7df92a415fd876e47aea1f155a21bc` with v0.2.6.
- Read-only staging smoke confirmed the five filter controls, filtering without collapsing the calendar grid,
  and both last-change and last-final-submission metadata. No staging data was written for the smoke.
- REPORT-06 and REPORT-20 are promoted to ready. Physical iPhone/Safari remains a separate P4 gate.

## 2026-09-20 report concurrency, comparison and v0.2.6

- Regular report save and historical restore now send the revision that the user actually loaded.
  A stale client receives a 409 instead of silently overwriting a newer report, while the unsaved
  local text remains visible so it can be copied before refresh.
- Report text writes preserve existing structured payload metadata, including manual adjustments,
  and repeated unchanged draft saves do not create meaningless extra history versions.
- History can compare an older report with the current version using a bounded line diff that shows
  added and removed lines. The comparison is capped to keep large historical reports responsive and
  includes a narrow/mobile layout.
- `df8c114` and `e36c554` both passed the canonical Cloudflare verify/deploy path. Live
  `/api/build` returned `e36c55459a423a1607f195532425acd357af7cc2` before the release bump.
  Read-only staging report inspection found only `revisionCount=1` in the current imported daily
  reports, so no staging data was mutated merely to manufacture a multi-version UI demonstration.
- Release metadata is advanced to v0.2.6 and now covers large resumable chat import, guarded
  archive deletion/leave parity, chat result analytics and safer report history. Production remains
  untouched.

## 2026-09-20 archive/delete/leave parity

- Archived rows retain reason/date and guarded restore. Permanent deletion is now a
  deliberately narrow exception: the canonical reason must be «Чат не існує»,
  joined Telegram/WhatsApp must have the latest leave confirmation, and the server
  rejects chats referenced by publications, leads or a pending Telegram slot.
- The destructive action has a separate confirmation and is never automatic. A
  successful delete writes an owner-scoped `chat_permanently_deleted` activity
  event with the deleted ID/name/link/archive snapshot; prior events remain facts.
  State-token, dependency and owner checks prevent stale or cross-owner deletion.
- No SQL migration or remote D1 operation is required. Focused archive/leave/delete
  coverage passed 27/27; full local `npm run verify` passed lint, 359/359 tests and
  the production build before documentation status was promoted.

## 2026-09-18 repository and P4 reconciliation

- GitHub staging Deployments/Environment from the retired Actions deploy path were removed after exporting local metadata; Cloudflare Workers Builds remains the only staging verify/deploy gate. Historical GitHub Actions run metadata was exported locally before cleanup.
- Repository branch noise was removed; main is the canonical remote branch. A local git bundle preserves the pre-cleanup branch refs for recovery if ever needed.
- REPORT-09, REPORT-21 and REPORT-22 were re-verified against current code with 14/14 focused tests: frozen workday plan, versioned goal history, and explicit report fact/manual-correction/result/source drill-down. PRODUCT_REQUIREMENTS now reflects that evidence.
- Current staging/application release remains v0.2.5; the restored update screen and current main passed Cloudflare verify/deploy.
- P4 parity reconciliation confirms PUB-04, PROFILE-12, AD-06/07/09, LEAD-24, ANALYTICS-22, SCRIPT-04 and KNOW-01/02 against current UI/domain code. A dedicated contract test protects those surfaces from documentation drift.
- History dialogs now return keyboard focus to the exact trigger that opened them across lead, lesson, chat, Library and Reports flows; focused regression coverage guards the controlled-dialog focus contract.
- Chat details now include owner-scoped 7/30/all-time result analytics with publications, responses, bookings, completed lessons, conversion rates and metric-to-event drill-down; source-chat attribution follows lead outcomes without rewriting historical data.


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

- The dialog now accepts one pasted list of up to 10,000 mixed links and splits
  preview/save work into bounded batches of at most 500 and 200 KB. The existing
  authenticated same-origin API remains capped at 500 per atomic request. Preview identifies new,
  existing, archived, repeated and invalid rows, with platform counts. Users can
  rename new chats, remove rows and return to the edited list before saving.
- Cross-batch duplicate detection happens before save. Every batch is previewed
  again against the latest workspace revision, saved with its own idempotency key,
  and contributes to visible total/completed/skipped/batch progress. A lost or
  malformed response retains the exact request for a safe retry; confirmed batches
  are never replayed, and later conflicts do not corrupt earlier atomic batches.
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
- Browser QA for the original <=500 path used the real dialog and handler with an in-memory local D1 harness:
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
- `npm run verify` passed on 2026-09-20: lint, 355/355 local tests and production
  build. Bulk coverage includes 1,203-row client chunking, cross-batch duplicates,
  10,000-row bounded preview, atomic 500-row saves and identical retry after an
  unknown transport result. Authenticated staging QA on build `3ece5e4` previewed
  501 synthetic unique links as two server batches and showed all 501 as new;
  the save action was deliberately not run, so staging data was unchanged. Safari/
  iPhone acceptance remains open. No production deployment.

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

## Manual curator requests

- A lead card can create one owner-scoped pending curator request with an explicit
  accounting date. The pending booking event is temporary: confirming it during
  lesson booking cancels that event and creates one lesson booking, while a second
  active request is rejected. Local domain regression covers the full transition;
  cancellation UI and mobile acceptance remain open.

## Paginated CRM conversation

- Lead detail now reads the latest 30 messages. Older pages are loaded on demand
  through an authenticated owner-scoped endpoint, with a time/ID cursor, a maximum
  of 50 messages and two SQL statements per page. A version check rejects pages
  after concurrent edits; the UI prevents overlapping loads and aborts on unmount.
- Local regression covers tied timestamps, deleted messages, owner isolation,
  stale versions, editing older messages and the existing history index without
  temporary sorting. Command handling no longer loads the whole CRM conversation:
  ordinary lead commands request zero messages, while message edit/delete loads only
  the addressed owner-scoped message. Full text export remains available but still
  reads the entire conversation; streaming/bounded export and browser/Safari
  acceptance remain open. No schema migration or remote D1 work is needed.

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

## Report staleness

- The report calendar now marks a submitted report as «Потребує оновлення» when
  an active or cancelled business event for that date happened after submission.
  Drafts stay neutral, the check is owner-scoped and bounded to the requested
  month, and a local regression covers both event changes and read-only behavior.
  Workday coloring and full mobile acceptance remain open.

## Report version restore

- The report history dialog can restore an older version as a new report revision
  while preserving whether it was a draft or submitted. The dialog stays blocked
  while the save is in flight and refreshes the selected report after success;
  full diff/concurrency checks and mobile acceptance remain open.

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


## Chat attribution staging acceptance — 2026-09-20

- Cloudflare staging is live on `14de9cd1ec32a520ab1c1d1c34364960f413b20b`
  (app version `0.2.6`) after the type-aware export-contract fix.
- A strictly read-only authenticated smoke confirmed the source-chat attribution
  table with the eight required columns, all four conversion labels and 16 live
  rows. Values rendered as integers/percentages with no `NaN` or error state.
- The UI explicitly distinguishes period publications from the lead cohort and
  keeps later repeat bookings attributed to the original source chat.
- This evidence closes ANALYTICS-15. ANALYTICS-10 remains partial because the
  remaining gap is advertisement-level attribution, not chat-level attribution.
- Production and production D1 were not changed.

## 2026-09-23 messenger integration decisions / local acceptance

- v0.2.28 working slice adds a WhatsApp-only server-filtered «Очікування» list/count and gives pending WhatsApp membership tasks priority in the executor queue. Fully automated messenger-side membership detection is still an adapter/live-acceptance gap.
- Product decision: WhatsApp automation is browser-first through a persistent authenticated WhatsApp Web session; a separate WhatsApp Desktop app is not required. Pending approval must be checked against real messenger state before promotion to joined.
- Product decision: Viber does not use the WhatsApp pending-approval flow. On the CachyOS reference workstation, the packaged Viber client is installed with `/usr/bin/viber`, `viber.desktop` is registered for `x-scheme-handler/viber`, and a Work OS Viber invite now opens the intended Viber chat successfully. The previous standalone AppImage was removed.
- Next operator-automation sequence after Discovery adapter acceptance is WhatsApp autopost → Viber autopost → shared retry/recovery, with exact target-chat verification before send and a confirmed-send callback before `published`.

- v0.2.35: Platforms archive-reason dialog uses native fieldset/legend semantics while preserving responsive touch targets; UX regression coverage guards the accessible grouping.


## Publication/data consistency hardening — 2026-09-23

- v0.2.36 makes a confirmed publication immediately reconcile the current Platforms read-model from an authoritative POST response: the row state/token, `publishedToday`, `availableToday` and global daily publication pace update without waiting for F5.
- The same successful mutation broadcasts an all-scope data change. The global server revision then refreshes Today and remounts server-derived Reports/Analytics/Library workspaces; Platforms stays mounted and performs a silent canonical reload so operator context does not flash/reset.
- Local-write revision acknowledgement no longer consumes the newer revision without refreshing dependent workspaces. Poll throttling also no longer consumes a revision that it skipped.
- The global sync checks the Europe/Kyiv business date on poll/focus/online/visibility and refreshes all daily read-models after midnight even when no write occurs.
- Historical report publication correction now broadcasts the same authoritative refresh instead of asking the operator to update manually.
- Regression coverage now guards publication→Undo consistency across `chat_publications`, active `activity_events`, report summary/day revision, available-today links, Library `usedToday`, Telegram schedule restoration/account isolation, and publication history after later chat archiving.
- Ambiguous publication network failures force a canonical reread before a retry, while the existing action gate, state token and unique chat/day publication constraint continue to prevent duplicate writes.
- Workers Builds remains the reliable staging build/deploy gate. The attempted change that ran full `verify:local` inside Workers Builds caused persistent failing GitHub checks and was reverted; `verify:local` remains the stronger separate pre-release gate when a suitable runner is available. Staging acceptance still requires a green Workers Build plus `/api/build` matching the release HEAD/version.


## Library advertisement UX cleanup — v0.2.37

- Advertisement Library now has an explicit platform filter derived from the currently loaded collection; changing collection/archive state safely resets that filter instead of leaving a hidden stale selection.
- Advertisement rows expose platform badges with operator-friendly Telegram/WhatsApp/Viber/Facebook labels, so platform scope is visible before opening the editor.
- Narrow/mobile Library toolbar is now a real one-column grid; collection tabs scroll horizontally and platform select keeps a 44px touch target instead of overflowing.
- Added source regression coverage for platform filtering, row context and responsive controls. This is code/test evidence; canonical staging full-gate acceptance remains required before marking the release deployed.


## Library advertisement operator metadata — v0.2.38

- Advertisement platforms now use one canonical supported set (Telegram, WhatsApp, Viber, Facebook). New/edited advertisement writes normalize casing/deduplicate and reject unsupported platform names; legacy rows are not rewritten in place.
- The advertisement editor replaces comma-separated platform entry with explicit controls and uses the shared subject vocabulary for structured directions while preserving extra custom/legacy tags.
- Legacy advertisements with an empty platform list remain semantically universal and now stay visible when a specific platform filter is selected. Existing unsupported metadata is surfaced to the operator instead of being silently trusted.
- UA/RU editing uses a two-column layout when space allows and collapses to one column on mobile; structured controls retain 44px mobile targets.
- Library GET derives same-day advertisement usage from canonical `chat_publications` grouped by platform and current Europe/Kyiv business date. Because manual Undo deletes the exact publication row, reuse visibility returns automatically without a second Library-specific accounting source.
- Feature commits `c7fca593` and `2e4b18af` both completed the canonical Cloudflare Workers staging build check successfully. Full `verify:local` was not run in this environment and is not claimed.


## Viber safe-mode operator flow — v0.2.39

- Library exposes a Viber-only safe-mode action for active Viber-compatible advertisements, with separate UA/RU material choices.
- The operator flow creates the existing idempotent `safe_note` job, polls canonical server state, exposes cancellation, and explicitly states that only «Мої нотатки» is allowed.
- Safe-mode remains non-accounting: its executor contract cannot create `chat_publications` or publication `activity_events`; real Viber chats remain outside this gate.
- Native Viber acceptance was not performed and is not claimed. Desktop Commander remains excluded because this is a native-app flow.


## Discovery executor target verification — v0.2.40

- WhatsApp/Viber external inspection can no longer promote membership or store an accessible inspected result without explicit exact-target confirmation.
- The target-proof requirement is executor-only: manual qualification in the authenticated Work OS UI keeps its existing path and is not accidentally blocked by adapter policy.
- Executor tasks carry expected chat identity, runtime intent and a fail-closed safety marker. External leave requires the same proof before Work OS archives or records canonical leave state.
- Reference-runner and UI contract regressions cover the wiring. Live WhatsApp Web automation acceptance and full verify:local remain separate evidence gates and are not claimed here.


## Platforms operator UX cleanup — v0.2.41

- Replaced the large decorative Platforms hero with a compact task header and moved platform switching into the same surface.
- Consolidated publication pace, daily goal, available, joined and published facts into one overview; the old stacked today-links/posting-pace surfaces are removed.
- Quick-publish now lives inside the ready queue where it is contextually relevant. The redundant toolbar queue badge was removed because the active queue tab already owns that count.
- The chat-row primary action is now «Підготувати», matching its actual behavior of opening the preparation dialog. Only the final dialog action records a publication fact.
- Removed obsolete platform-hero/today-links/posting-pace/quick-publish-bar code paths and extracted the overview/copy behavior into `components/platform-overview.tsx` to reduce the main workspace component.
- Source/UX regression coverage was updated for the compact hierarchy and responsive behavior. Cloudflare build and live staging visual acceptance are not yet claimed in this entry.


## Platforms queue transition cleanup — v0.2.42

- The recorded queue-tab flash was caused by intentionally nulling the effective dataset whenever requestKey changed. Platforms now reuses a matching in-memory view and prefetches sibling queues after the canonical first load.
- Cached views remain provisional UX state. Chat mutations, imports/profile changes and server revision sync invalidate cache, then the existing silent authoritative reload reconciles D1 state.
- The recurring full-list spinner is removed for normal queue switching while a genuine uncached first request/search/filter/page still has an explicit loading state.
- The Cloudflare skipped builds visible during the previous cleanup are superseded intermediate main commits, not failed release evidence. GitHub-first work should be batched into one coherent commit per slice where possible to avoid unnecessary intermediate Workers Builds.
- Full verify and staging /api/build match are not claimed until Cloudflare finishes the release commit.


## Unified loading and transition architecture — v0.2.43

- Core navigation now keeps each visited workspace mounted. Platforms, CRM, Analytics, Reports, Library and Settings retain their local UI state instead of being destroyed and recreated on every navigation change.
- Loading semantics are shared: first load may render a stable skeleton, same-view revalidation keeps useful data mounted, and background refresh feedback is non-blocking and delayed to avoid visual flicker on fast requests.
- Library uses exact collection/archive/search view keys with request sequencing; Reports keeps date/month caches; high-frequency history/detail/preparation surfaces keep context-specific caches instead of clearing to empty arrays before every fetch.
- React `key` is no longer used as the refresh mechanism for chat profile/history/publish preparation or CRM conversation updates. Prop/revision synchronization owns those transitions.
- Returning to Today now dispatches a revision-check request. ServerSync performs the lightweight authoritative check and only uses RSC refresh when the server revision or Kyiv business date actually requires it.
- Persistent hidden workspaces close portal overlays and disable hidden keyboard handlers/portal-heavy children so retained state cannot interact with the active view.
- Regression coverage now scans product components for the legacy `workspace-loading` class, guards exact-view Library identity, persistent workspace wiring, nested loading caches and remount-key regressions.
- Source review found and removed a stale release-date regression that still required 2026-09-23; release-date coverage now validates canonical ISO metadata rather than hardcoding yesterday's date.
- Full lint/typecheck/test/build evidence and live staging transition acceptance are not claimed until the release build provides them.


## 2026-09-25 — D1 read-budget hardening and local-first Discovery

- Platforms' ordinary GET no longer recomputes queue totals/profile counts across all chats. Migration `0039_chat_queue_read_model.sql` creates owner/platform/account/status counters maintained by chat/profile triggers and adds index-friendly chat/discovery indexes.
- The visible chat page is selected by indexed `updated_at DESC,id` with `LIMIT 50`; published/snoozed presentation ordering is applied only to that fetched page instead of forcing a full computed sort before the limit.
- High-cost workspace reads now use a revision-aware Cloudflare Worker Cache API layer: Platforms, Analytics, Analytics overview, Library, Reports and Leads list. Cache identity includes owner + authoritative `backup_revisions.revision` + exact view; writes therefore invalidate by key without explicit cache deletion. Time-sensitive views use short time buckets.
- Discovery duplicate checks no longer load up to 10,000 existing chats. Local preview batches issue targeted indexed lookups only for links actually found in that batch.
- Product storage semantics changed: public/Telegram source results are preview-only and live in browser `sessionStorage`; search itself does not insert candidates, sources or chats into D1. The UI labels these rows «Локально · не в D1».
- «Відкинути локально» removes a preview with no D1 write. «Підходить → додати» is the explicit persistence boundary: only then is the candidate/source stored and handed off to canonical `to_join`.
- The paired executor no longer advances source crawl. It handles only confirmed persisted messenger tasks and retains exact-target/fail-closed rules for join, pending recheck, qualification and leave.
- Old server `continue` / `ingest-telegram` persistence paths are blocked; manual Telegram recovery now also feeds local preview.
- Cloudflare Workers builds through the local-preview/UI commits are green. Production and production D1 were not changed.
- Remaining Discovery acceptance gap is physical end-to-end WhatsApp Web validation and real-world source-yield tuning, not the core source/dedupe/persistence state machine.


## 2026-09-25 — WhatsApp Discovery GO-LIVE mode

- Product mode changed from open-ended autonomous development to a bounded go-live campaign.
- The only active P0 outcome is real operator-usable WhatsApp Discovery on staging: local source preview → explicit confirm → canonical to_join → real WhatsApp Web join/pending → factual qualification → target ready or verified reject/leave.
- Code-only improvements do not close this outcome. Completion requires physical authenticated WhatsApp Web evidence on exact staging HEAD and no manual SQL/API intervention in the normal flow.
- Default target remains 50 confirmed target chats. This is a search goal, not a guaranteed yield; source exhaustion must be reported honestly.
- Local-first persistence and D1 budget work from the previous slice are prerequisites, not the final acceptance.
- Until GO-LIVE-01…09 in ROADMAP are closed, unrelated feature development is intentionally paused.


## 2026-09-25 — Discovery local WhatsApp preflight correction

- Product correction after live UI review: a local invite/source match is not a target. The autonomous goal now counts only candidates that are factually opened in WhatsApp Web, directly joined and qualified against the target criteria.
- Search/preflight remains D1-write-free. Browser session state carries queued/target/rejected/skipped candidates; D1 is used during search only for targeted exact-link duplicate reads. Final operator confirmation is the first Discovery persistence boundary for new target chats.
- The local WhatsApp bridge skips factual admin-approval/request-to-join invites without clicking the request control. Existing canonical pending lifecycle remains for older/manual chats, but pending candidates do not count toward autonomous Discovery goal.
- Joined non-targets are left through the exact-target verified leave adapter before the local result is finalized. A second invite resolving to the same observed chat identity is suppressed rather than inflating target count.
- Focused source/runner/UI/WhatsApp adapter regressions pass 68/68 in an ephemeral test workspace. Physical live acceptance is not yet claimed: after the workstation reboot Opera is running without the required local CDP endpoint and the Discovery runner is not active.

- Strict follow-up after preflight correction: post-join Ukrainian audience may no longer fall back to source-topic inference; additional request-to-join labels are skipped; WhatsApp preflight can traverse bounded View/Continue → Join steps; final local UI defaults to factual targets and source exhaustion reports factual target count.

- Reboot/live acceptance exposed a browser bridge bug when more than one Work OS tab shared the same origin: the runner could bind to an inactive tab and leave local candidates queued forever. The CDP bridge now scans all matching Work OS tabs, selects the one with an active local run/task, and writes the result back only to the tab containing that exact candidate.

- Live run after reboot processed 55 invite candidates, eliminated 35 duplicates and completed 20 WhatsApp preflights before one transient HTML/5xx preview response stopped the browser loop. This is now non-fatal: source search retries preview calls up to 3 times with bounded backoff and keeps the local run active instead of resetting/stopping it.


### 2026-09-29 — WhatsApp fresh-join flow
- Timed waiting for post-join messages was replaced by a non-blocking manual-review outcome.
- Freshly joined chats that pass all immediately observable hard gates but lack hidden pre-join activity/ad evidence are persisted as `review` and removed from the automation queue.
- Legacy post-join waiting checkpoints are selected immediately and migrated; confirmed targets still require the full factual criteria.
- Discovery UI separates active checks, manual review, confirmed targets and archive states, and explains browser-run progress versus durable Work OS decisions without D1/runtime jargon.
