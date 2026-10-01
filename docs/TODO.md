# TODO

Відомі проблеми, які існували в `main` до 2026-10-01 і поки не виправлені. Push вони не блокують (див. `CLAUDE.md`), але кожна зміна не повинна додавати нових.

## 1. Тести, що падають

Стан на 2026-10-01: `npm run test:full` — 857 тестів, із них 92 падають. Ні тести, ні код не змінювалися, щоб їх полагодити. Переважно це застарілі source-contract перевірки (regex шукає рядки, яких у коді вже немає) і поведінкові тести chat-discovery.

### `tests/analytics-ui-copy.test.mjs` (1)
- [ ] `tests/analytics-ui-copy.test.mjs:5` — Analytics archive reasons render localized operator-facing labels

### `tests/app-update-sync.test.mjs` (1)
- [ ] `tests/app-update-sync.test.mjs:31` — cross-device sync uses the existing monotonic backup revision as source of truth

### `tests/chat-discovery-cloud.test.mjs` (14)
- [ ] `tests/chat-discovery-cloud.test.mjs:29` — local preview falls back to a clean source label when extracted HTML name is noisy
- [ ] `tests/chat-discovery-cloud.test.mjs:105` — Telegram discovery accepts only factual Ukrainian invite snippets from Brave and rejects unrelated catalogues
- [ ] `tests/chat-discovery-cloud.test.mjs:173` — local-first discovery starts with bounded Telegram batches and avoids the heavy curated bootstrap
- [ ] `tests/chat-discovery-cloud.test.mjs:228` — Telegram public discovery broadens search only when the strict result lacks enough public sources
- [ ] `tests/chat-discovery-cloud.test.mjs:269` — Telegram source ranking compares all query variants before fetching the single best source
- [ ] `tests/chat-discovery-cloud.test.mjs:297` — Telegram public source budget is channel-deduplicated before page fetch
- [ ] `tests/chat-discovery-cloud.test.mjs:323` — Telegram public history follow-up is same-channel, before-only and bounded to one extra page per task
- [ ] `tests/chat-discovery-cloud.test.mjs:349` — Telegram public history does not paginate when the first preview already contains an invite
- [ ] `tests/chat-discovery-cloud.test.mjs:379` — Discovery reset removes only discovery workspace state and preserves linked chats for dedupe
- [ ] `tests/chat-discovery-cloud.test.mjs:646` — qualification is fail-closed until every target criterion is confirmed
- [ ] `tests/chat-discovery-cloud.test.mjs:748` — autonomous Discovery advances the seed matrix through public Telegram pages without operator query input
- [ ] `tests/chat-discovery-cloud.test.mjs:779` — Discovery goal counts only new confirmed targets, never raw invite yield
- [ ] `tests/chat-discovery-cloud.test.mjs:820` — archived unavailable WhatsApp history suppresses rediscovery and automatic rejoin in later runs
- [ ] `tests/chat-discovery-cloud.test.mjs:1478` — joined inspection with unknown rules stays ready but explicitly needs qualification

### `tests/chat-discovery-runner.test.mjs` (12)
- [ ] `tests/chat-discovery-runner.test.mjs:140` — retry-later skips only the affected local candidate with short cooldown
- [ ] `tests/chat-discovery-runner.test.mjs:149` — local retry-later skips only that invite and does not globally freeze WhatsApp preflight
- [ ] `tests/chat-discovery-runner.test.mjs:162` — a single slow WhatsApp page cannot trap the browser-local queue forever
- [ ] `tests/chat-discovery-runner.test.mjs:170` — unknown factual qualification is deferred instead of rejected or used as a destructive leave reason
- [ ] `tests/chat-discovery-runner.test.mjs:183` — local Discovery can refill sources while WhatsApp qualification is in flight
- [ ] `tests/chat-discovery-runner.test.mjs:190` — local Discovery keeps a local source pump filled while WhatsApp runs
- [ ] `tests/chat-discovery-runner.test.mjs:197` — local Discovery rejects impossible candidates before join
- [ ] `tests/chat-discovery-runner.test.mjs:205` — temporary source deferral advances one query instead of freezing the run
- [ ] `tests/chat-discovery-runner.test.mjs:213` — local Discovery metadata-screens before any heavy WhatsApp invite UI
- [ ] `tests/chat-discovery-runner.test.mjs:224` — blocked metadata candidates do not fill the active local source queue
- [ ] `tests/chat-discovery-runner.test.mjs:231` — local Discovery direct-joins qualified invites without Page.navigate
- [ ] `tests/chat-discovery-runner.test.mjs:262` — fresh local run clears inherited source wait

### `tests/chat-discovery-scan-gate.test.mjs` (1)
- [ ] `tests/chat-discovery-scan-gate.test.mjs:5` — manual Telegram recovery stays tied to the planned query while autonomous source advancement is executor-owned

### `tests/chat-discovery-ui.test.mjs` (4)
- [ ] `tests/chat-discovery-ui.test.mjs:43` — browser-local source crawl uses targeted D1 dedupe and no owner-wide 10k scan
- [ ] `tests/chat-discovery-ui.test.mjs:158` — candidate cards lead with human-readable automation status and keep criteria collapsed
- [ ] `tests/chat-discovery-ui.test.mjs:334` — pausing autonomous discovery preserves unfinished candidates and momentum
- [ ] `tests/chat-discovery-ui.test.mjs:347` — resuming a paused discovery run keeps cursor candidates and durable dedupe history

### `tests/chat-transitions.test.mjs` (1)
- [ ] `tests/chat-transitions.test.mjs:264` — expired publication undo leaves the publication and event unchanged

### `tests/chats-workflow.test.mjs` (8)
- [ ] `tests/chats-workflow.test.mjs:67` — publication is blocked during snooze and concurrent retries record exactly one event
- [ ] `tests/chats-workflow.test.mjs:92` — unqualified discovery chats are excluded from posting until target is confirmed
- [ ] `tests/chats-workflow.test.mjs:112` — publication and event roll back together if the event write fails
- [ ] `tests/chats-workflow.test.mjs:121` — manual publication attributes one active owner-scoped advertisement atomically
- [ ] `tests/chats-workflow.test.mjs:138` — quick publish may reuse one active material across WhatsApp chats without weakening normal reuse rules
- [ ] `tests/chats-workflow.test.mjs:203` — publication and undo keep canonical publication facts, report totals and available links in sync
- [ ] `tests/chats-workflow.test.mjs:228` — archiving a chat after publication preserves historical publication metrics
- [ ] `tests/chats-workflow.test.mjs:246` — Today and Analytics follow the same active publication fact through Undo

### `tests/d1-budget-contract.test.mjs` (1)
- [ ] `tests/d1-budget-contract.test.mjs:39` — Discovery search is local-first and D1 work stays targeted until explicit confirmation

### `tests/d1-quota-recovery.test.mjs` (1)
- [ ] `tests/d1-quota-recovery.test.mjs:13` — root page renders a dedicated quota recovery surface without retry controls

### `tests/dashboard-bootstrap.test.mjs` (1)
- [ ] `tests/dashboard-bootstrap.test.mjs:5` — home SSR only authenticates and defers dashboard work to JSON bootstrap

### `tests/discovery-reliability.test.mjs` (1)
- [ ] `tests/discovery-reliability.test.mjs:235` — joined recovery without groupId refreshes invite metadata before inspection and never rejoins

### `tests/discovery-source-outcomes.test.mjs` (21)
- [ ] `tests/discovery-source-outcomes.test.mjs:19` — workbook plan includes compatible keywords, countries and city aliases
- [ ] `tests/discovery-source-outcomes.test.mjs:78` — repeated global WhatsApp loading triggers a bounded self-heal reload
- [ ] `tests/discovery-source-outcomes.test.mjs:108` — legacy Brave rate-limit source stop is narrowly recoverable
- [ ] `tests/discovery-source-outcomes.test.mjs:120` — global WhatsApp message loading is deferred without burning the full invite timeout
- [ ] `tests/discovery-source-outcomes.test.mjs:163` — web-search 429 does not fail the source step when Telegram graph fallback exists
- [ ] `tests/discovery-source-outcomes.test.mjs:176` — search advances with a warning when all optional search sources are unavailable
- [ ] `tests/discovery-source-outcomes.test.mjs:189` — TG.ME directory ranks concrete Ukrainian Telegram posts
- [ ] `tests/discovery-source-outcomes.test.mjs:209` — TG.ME post result can feed a WhatsApp invite directly into local preview source
- [ ] `tests/discovery-source-outcomes.test.mjs:222` — directory channel result is searched inside Telegram for group invites
- [ ] `tests/discovery-source-outcomes.test.mjs:255` — WhatsApp topic matcher includes local-language Ukrainian identity roots
- [ ] `tests/discovery-source-outcomes.test.mjs:277` — search challenge skips the exact query when Telegram directory also fails
- [ ] `tests/discovery-source-outcomes.test.mjs:289` — temporary external search failure warns and advances when Telegram directory also fails
- [ ] `tests/discovery-source-outcomes.test.mjs:307` — source crawl keeps scanning Telegram history even after a current-page invite
- [ ] `tests/discovery-source-outcomes.test.mjs:341` — runner passes invite metadata into joined qualification to avoid redundant info opening
- [ ] `tests/discovery-source-outcomes.test.mjs:355` — metadata failure defers candidate without opening the heavy WhatsApp UI
- [ ] `tests/discovery-source-outcomes.test.mjs:369` — unknown qualification has bounded retries and never leaves a joined chat
- [ ] `tests/discovery-source-outcomes.test.mjs:386` — source plan is read from the authorized Work OS browser session without HTTP
- [ ] `tests/discovery-source-outcomes.test.mjs:416` — source bridge keeps cursor on preview failure and reports a resumable stop
- [ ] `tests/discovery-source-outcomes.test.mjs:454` — WhatsApp invite metadata and UI inspection foreground the WhatsApp tab first
- [ ] `tests/discovery-source-outcomes.test.mjs:516` — direct qualification ignores WhatsApp service events for activity
- [ ] `tests/discovery-source-outcomes.test.mjs:618` — TG.ME group-invite preview can feed a WhatsApp invite directly

### `tests/lead-attachments-ui.test.mjs` (1)
- [ ] `tests/lead-attachments-ui.test.mjs:7` — LEAD-23 exposes bounded media upload, preview/download and delete controls

### `tests/library-advertisement-ux.test.mjs` (1)
- [ ] `tests/library-advertisement-ux.test.mjs:9` — advertisement library exposes platform filtering without affecting other collections

### `tests/p4-parity-contracts.test.mjs` (5)
- [ ] `tests/p4-parity-contracts.test.mjs:8` — PUB-04 and PROFILE-12 are present in the real operator flow
- [ ] `tests/p4-parity-contracts.test.mjs:80` — manual publishing and profile management cover the remaining operator parity surfaces
- [ ] `tests/p4-parity-contracts.test.mjs:113` — WhatsApp and Viber quick publishing locks one material without bypassing normal publication rules
- [ ] `tests/p4-parity-contracts.test.mjs:150` — chat operator flow keeps grouped copy, fast archive and archived-chat exclusion explicit
- [ ] `tests/p4-parity-contracts.test.mjs:160` — chat archive reasons, available-now links and Telegram duplicate scope are explicit

### `tests/platform-publication-sync.test.mjs` (1)
- [ ] `tests/platform-publication-sync.test.mjs:72` — WhatsApp waiting queue explains automatic pending membership rechecks

### `tests/release-copy.test.mjs` (1)
- [ ] `tests/release-copy.test.mjs:10` — release notes stay short and understandable for people

### `tests/report-activity-revision.test.mjs` (1)
- [ ] `tests/report-activity-revision.test.mjs:103` — publication and Undo both invalidate a submitted report while the live summary returns to zero

### `tests/report-submission-ui.test.mjs` (1)
- [ ] `tests/report-submission-ui.test.mjs:7` — reports editor exposes the last final submission time without replacing last-change metadata

### `tests/report-write.test.mjs` (1)
- [ ] `tests/report-write.test.mjs:55` — report UI and restore path send the loaded revision and preserve local text on conflict

### `tests/telegram-schedule-manual-selection.test.mjs` (1)
- [ ] `tests/telegram-schedule-manual-selection.test.mjs:20` — manual scheduler blocks generation when selected eligible chats cannot fill every requested slot

### `tests/telegram-schedule.test.mjs` (4)
- [ ] `tests/telegram-schedule.test.mjs:43` — generation is account-isolated, eligible-only and retry-idempotent
- [ ] `tests/telegram-schedule.test.mjs:65` — manual selection persists per account and slot edits do not shift other times
- [ ] `tests/telegram-schedule.test.mjs:108` — publication completes only the matching account slot and preserves other accounts
- [ ] `tests/telegram-schedule.test.mjs:167` — publication undo restores exactly the matching Telegram slot and keeps other accounts isolated

### `tests/ux-contracts.test.mjs` (2)
- [ ] `tests/ux-contracts.test.mjs:180` — Platforms uses a compact operator hierarchy and an unambiguous publication CTA
- [ ] `tests/ux-contracts.test.mjs:391` — Empty Library uses one focused empty state instead of a redundant editor panel

### `tests/viber-joined-today-panel.test.mjs` (1)
- [ ] `tests/viber-joined-today-panel.test.mjs:27` — Viber workspace exposes a compact expandable joined-today panel in the queue header area

### `tests/whatsapp-autopost-caption-contract.test.mjs` (1)
- [ ] `tests/whatsapp-autopost-caption-contract.test.mjs:15` — caption override is snapshotted into jobs and does not require equality with Library text

### `tests/whatsapp-web-cdp.test.mjs` (2)
- [ ] `tests/whatsapp-web-cdp.test.mjs:689` — WhatsApp inspect and leave share one bounded operation timeout instead of resetting 45s at every UI phase
- [ ] `tests/whatsapp-web-cdp.test.mjs:726` — joined WhatsApp qualification waits for the chat UI before reading facts

### `tests/workspace-loading-contract.test.mjs` (1)
- [ ] `tests/workspace-loading-contract.test.mjs:56` — known transition hot spots retain data while revalidating

Примітка: `tests/discovery-source-outcomes.test.mjs` до 2026-10-01 взагалі не парсився (синтаксичні помилки), тому раніше рахувався як одне падіння. Після виправлення синтаксису його тести запускаються, і 21 з них падає.

## 2. Lint-помилки, приглушені точковими коментарями

27 помилок (24 коментарі) позначено `oxlint-disable-next-line ... -- TODO: потребує зміни логіки/розмітки (docs/TODO.md)`. Виправлення змінює поведінку, тому потребує окремої задачі. Знайти всі: `grep -rn "docs/TODO.md" components`.

- [ ] `react/react-compiler` EffectSetState (setState синхронно в useEffect): `components/chat-discovery-dialog.tsx`, `chat-profile-dialog.tsx`, `leads/workspace.tsx`, `library-workspace.tsx`, `platform-workspace.tsx`, `reports-workspace.tsx`, `settings-workspace.tsx`.
- [ ] `react/react-compiler` Refs (ref.current під час render): `components/leads/workspace.tsx`, `library-workspace.tsx`, `platform-workspace.tsx`.
- [ ] `react/react-compiler` PreserveManualMemo: `components/server-sync.tsx` (`checkRevision`).
- [ ] `react-hooks/exhaustive-deps`: `components/platform-workspace.tsx` (effect з `[filterKey]` без `platform` і `queue`).
- [ ] `jsx-a11y/prefer-tag-over-role` (`role="status"` → `<output>`): `components/chat-discovery-dialog.tsx`, `library-workspace.tsx` (4), `platform-workspace.tsx` (2).

## 3. Знайдені баги

- [x] `scripts/whatsapp-web-cdp.mjs`: regex-и всередині template literal (код, який виконується у вкладці через CDP) втрачали escape-послідовності (`\s` → `s`, `\b` → backspace, `\.` → будь-який символ). Виправлено 2026-10-01: подвійні escape, межа слова для кирилиці через `(?![\p{L}\p{N}_])`; регресійний тест `tests/whatsapp-web-cdp-injected-regex.test.mjs` перевіряє всі template literal файлу.

