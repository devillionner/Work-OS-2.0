# TODO

Відомі проблеми, які існували в `main` до 2026-10-01 і поки не виправлені. Push вони не блокують (див. `CLAUDE.md`), але кожна зміна не повинна додавати нових.

## 1. Тести, що падають

Стан на 2026-10-02: `npm run test:full` — 51 падіння (було 71). Виправлено всі недискаверні: це були застарілі перевірки коду після переробок (перейменування, перенесення в `PlatformOverview`, нові межі D1), а одна — справжня регресія: зник окремий екран «вичерпано денний ліміт бази», його відновлено в `components/work-os-bootstrap.tsx`. Решта — тести Discovery: runner і адаптер переписали 2026-09-29 без локального прогону тестів, тож частина падінь може означати втрачену поведінку, а не лише застарілий текст. Їх розбирають окремо, кожен перевіряючи по коду.

### `tests/chat-discovery-cloud.test.mjs` (14)
- [ ] `tests/chat-discovery-cloud.test.mjs:30` — local preview falls back to a clean source label when extracted HTML name is noisy
- [ ] `tests/chat-discovery-cloud.test.mjs:106` — Telegram discovery accepts only factual Ukrainian invite snippets from Brave and rejects unrelated catalogues
- [ ] `tests/chat-discovery-cloud.test.mjs:174` — local-first discovery starts with bounded Telegram batches and avoids the heavy curated bootstrap
- [ ] `tests/chat-discovery-cloud.test.mjs:229` — Telegram public discovery broadens search only when the strict result lacks enough public sources
- [ ] `tests/chat-discovery-cloud.test.mjs:270` — Telegram source ranking compares all query variants before fetching the single best source
- [ ] `tests/chat-discovery-cloud.test.mjs:298` — Telegram public source budget is channel-deduplicated before page fetch
- [ ] `tests/chat-discovery-cloud.test.mjs:324` — Telegram public history follow-up is same-channel, before-only and bounded to one extra page per task
- [ ] `tests/chat-discovery-cloud.test.mjs:350` — Telegram public history does not paginate when the first preview already contains an invite
- [ ] `tests/chat-discovery-cloud.test.mjs:380` — Discovery reset removes only discovery workspace state and preserves linked chats for dedupe
- [ ] `tests/chat-discovery-cloud.test.mjs:647` — qualification is fail-closed until every target criterion is confirmed
- [ ] `tests/chat-discovery-cloud.test.mjs:749` — autonomous Discovery advances the seed matrix through public Telegram pages without operator query input
- [ ] `tests/chat-discovery-cloud.test.mjs:780` — Discovery goal counts only new confirmed targets, never raw invite yield
- [ ] `tests/chat-discovery-cloud.test.mjs:821` — archived unavailable WhatsApp history suppresses rediscovery and automatic rejoin in later runs
- [ ] `tests/chat-discovery-cloud.test.mjs:1479` — joined inspection with unknown rules stays ready but explicitly needs qualification

### `tests/chat-discovery-runner.test.mjs` (12)
- [ ] `tests/chat-discovery-runner.test.mjs:140` — retry-later skips only the affected local candidate with short cooldown
- [ ] `tests/chat-discovery-runner.test.mjs:149` — local retry-later skips only that invite and does not globally freeze WhatsApp preflight
- [ ] `tests/chat-discovery-runner.test.mjs:166` — a single slow WhatsApp page cannot trap the browser-local queue forever
- [ ] `tests/chat-discovery-runner.test.mjs:174` — unknown factual qualification is deferred instead of rejected or used as a destructive leave reason
- [ ] `tests/chat-discovery-runner.test.mjs:187` — local Discovery can refill sources while WhatsApp qualification is in flight
- [ ] `tests/chat-discovery-runner.test.mjs:194` — local Discovery keeps a local source pump filled while WhatsApp runs
- [ ] `tests/chat-discovery-runner.test.mjs:201` — local Discovery rejects impossible candidates before join
- [ ] `tests/chat-discovery-runner.test.mjs:209` — temporary source deferral advances one query instead of freezing the run
- [ ] `tests/chat-discovery-runner.test.mjs:217` — local Discovery metadata-screens before any heavy WhatsApp invite UI
- [ ] `tests/chat-discovery-runner.test.mjs:228` — blocked metadata candidates do not fill the active local source queue
- [ ] `tests/chat-discovery-runner.test.mjs:235` — local Discovery direct-joins qualified invites without Page.navigate
- [ ] `tests/chat-discovery-runner.test.mjs:266` — fresh local run clears inherited source wait

### `tests/chat-discovery-ui.test.mjs` (4)
- [ ] `tests/chat-discovery-ui.test.mjs:43` — browser-local source crawl uses targeted D1 dedupe and no owner-wide 10k scan
- [ ] `tests/chat-discovery-ui.test.mjs:161` — candidate cards lead with human-readable automation status and keep criteria collapsed
- [ ] `tests/chat-discovery-ui.test.mjs:337` — pausing autonomous discovery preserves unfinished candidates and momentum
- [ ] `tests/chat-discovery-ui.test.mjs:350` — resuming a paused discovery run keeps cursor candidates and durable dedupe history

### `tests/discovery-reliability.test.mjs` (1)
- [ ] `tests/discovery-reliability.test.mjs:235` — joined recovery without groupId refreshes invite metadata before inspection and never rejoins

### `tests/discovery-source-outcomes.test.mjs` (20)
- [ ] `tests/discovery-source-outcomes.test.mjs:19` — workbook plan includes compatible keywords, countries and city aliases
- [ ] `tests/discovery-source-outcomes.test.mjs:82` — repeated global WhatsApp loading triggers a bounded self-heal reload
- [ ] `tests/discovery-source-outcomes.test.mjs:124` — global WhatsApp message loading is deferred without burning the full invite timeout
- [ ] `tests/discovery-source-outcomes.test.mjs:167` — web-search 429 does not fail the source step when Telegram graph fallback exists
- [ ] `tests/discovery-source-outcomes.test.mjs:180` — search advances with a warning when all optional search sources are unavailable
- [ ] `tests/discovery-source-outcomes.test.mjs:193` — TG.ME directory ranks concrete Ukrainian Telegram posts
- [ ] `tests/discovery-source-outcomes.test.mjs:213` — TG.ME post result can feed a WhatsApp invite directly into local preview source
- [ ] `tests/discovery-source-outcomes.test.mjs:226` — directory channel result is searched inside Telegram for group invites
- [ ] `tests/discovery-source-outcomes.test.mjs:259` — WhatsApp topic matcher includes local-language Ukrainian identity roots
- [ ] `tests/discovery-source-outcomes.test.mjs:281` — search challenge skips the exact query when Telegram directory also fails
- [ ] `tests/discovery-source-outcomes.test.mjs:293` — temporary external search failure warns and advances when Telegram directory also fails
- [ ] `tests/discovery-source-outcomes.test.mjs:311` — source crawl keeps scanning Telegram history even after a current-page invite
- [ ] `tests/discovery-source-outcomes.test.mjs:345` — runner passes invite metadata into joined qualification to avoid redundant info opening
- [ ] `tests/discovery-source-outcomes.test.mjs:359` — metadata failure defers candidate without opening the heavy WhatsApp UI
- [ ] `tests/discovery-source-outcomes.test.mjs:373` — unknown qualification has bounded retries and never leaves a joined chat
- [ ] `tests/discovery-source-outcomes.test.mjs:390` — source plan is read from the authorized Work OS browser session without HTTP
- [ ] `tests/discovery-source-outcomes.test.mjs:420` — source bridge keeps cursor on preview failure and reports a resumable stop
- [ ] `tests/discovery-source-outcomes.test.mjs:458` — WhatsApp invite metadata and UI inspection foreground the WhatsApp tab first
- [ ] `tests/discovery-source-outcomes.test.mjs:520` — direct qualification ignores WhatsApp service events for activity
- [ ] `tests/discovery-source-outcomes.test.mjs:622` — TG.ME group-invite preview can feed a WhatsApp invite directly

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

