# TODO

Відомі проблеми, які існували в `main` до 2026-10-01 і поки не виправлені. Push вони не блокують (див. `CLAUDE.md`), але кожна зміна не повинна додавати нових.

## 1. Тести, що падають

Стан на 2026-10-02: `npm run test:full` — 31 падіння (було 71). Виправлено всі недискаверні: це були застарілі перевірки коду після переробок (перейменування, перенесення в `PlatformOverview`, нові межі D1), а одна — справжня регресія: зник окремий екран «вичерпано денний ліміт бази», його відновлено в `components/work-os-bootstrap.tsx`. Решта — тести Discovery: runner і адаптер переписали 2026-09-29 без локального прогону тестів, тож частина падінь може означати втрачену поведінку, а не лише застарілий текст. Їх розбирають окремо, кожен перевіряючи по коду. Runner/UI/reliability уже переписано під єдиний механізм відкладення (`deferLocalPreflight`, до 3 спроб); лишилися `chat-discovery-cloud` і `discovery-source-outcomes` (31). Спільна причина, перевірена на першому з них: серверний пошук (`searchLocalDiscoveryPreview`) обмежено одним запитом за виклик (`batchSize=1`), а куровані джерела вимкнено (`includeCurated:false`) — їх тепер обходить браузерний runner (`scripts/chat-discovery-source-crawl.mjs`). Тести ж чекають, що сервер за один виклик пройде Telegram і веб-джерела. Їх треба переносити на браузерний обхід або на покрокові виклики разом із живою перевіркою автопошуку — правити наосліп ризиковано. Перевірено 2026-10-02 на тестах обходу джерел (`discovery-source-outcomes`): план тепер починається з країн («Українці Німеччина» на кроці 15) і формулює запити без «в»; 429 від пошуковика коректно не валить крок (курсор іде далі, є попередження), але вибір джерел графа Telegram залежить від рейтингу й стану, накопиченого між тестами, тож тести зі статичними даними («Бремен») більше не потрапляють у потрібне джерело. Ці тести треба переписувати з ізольованим станом графа.

Можлива регресія (не виправлялась навмання): локальна кваліфікація тепер приймає `chatType==='community'` (батьківські спільноти WhatsApp), тоді як раніше їх, схоже, відсіювали до вступу. Безпечно — після вступу перевірка «можна писати» відкидає оголошувальну групу, — але вступ зайвий. Потребує рішення.

### `tests/chat-discovery-cloud.test.mjs` (13)
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

### `tests/discovery-source-outcomes.test.mjs` (18)
- [ ] `tests/discovery-source-outcomes.test.mjs:82` — repeated global WhatsApp loading triggers a bounded self-heal reload
- [ ] `tests/discovery-source-outcomes.test.mjs:124` — global WhatsApp message loading is deferred without burning the full invite timeout
- [ ] `tests/discovery-source-outcomes.test.mjs:167` — web-search 429 does not fail the source step when Telegram graph fallback exists
- [ ] `tests/discovery-source-outcomes.test.mjs:180` — search advances with a warning when all optional search sources are unavailable
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

- [ ] Політика автопошуку для вступлених груп з невідомими критеріями суперечлива: `lib/chat-discovery/inspection.ts` (executor, `requireTargetVerification`) перетворює `review` на `rejected` + `qualification_unverified` і запускає вихід, а вимога 2026-09-29 каже, що incomplete не має видаватися за невідповідність. 2026-10-02 так було залишено групу «Загальний». Потрібне рішення: залишати (fail-closed) чи відкладати й показувати оператору.

- [x] `scripts/whatsapp-web-cdp.mjs`: regex-и всередині template literal (код, який виконується у вкладці через CDP) втрачали escape-послідовності (`\s` → `s`, `\b` → backspace, `\.` → будь-який символ). Виправлено 2026-10-01: подвійні escape, межа слова для кирилиці через `(?![\p{L}\p{N}_])`; регресійний тест `tests/whatsapp-web-cdp-injected-regex.test.mjs` перевіряє всі template literal файлу.

