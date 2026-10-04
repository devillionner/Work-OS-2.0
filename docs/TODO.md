# TODO

Відомі проблеми, які існували в `main` до 2026-10-01 і поки не виправлені. Push вони не блокують (див. `CLAUDE.md`), але кожна зміна не повинна додавати нових.

## 1. Тести, що падають

Стан на 2026-10-04 (після коміту 3f): `npm run test:full` — 907/938, ті самі 31 падіння, що й нижче (звірено за назвами `diff`-ом, нових нема).

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

- [x] `normalized_link IN (SELECT value FROM json_each(?2))` без платформи перебирав усі рядки власника. Виправлено 2026-10-02 парами `[платформа, посилання]` + `CROSS JOIN json_each` по унікальному індексу `(user_id, platform, normalized_link)`: `prepareLocalPreviews` (7004 → ≤10 рядків), `lib/chat-discovery/domain.ts` (`readExistingCanonicalLinks`, `readExistingCandidates`), `lib/chats/name-enrichment.ts` (20 посилань серед ~5000 чатів — 21 рядок; `EXPLAIN QUERY PLAN`: `SEARCH ... USING INDEX`). Лише локальні тести.
- [x] Список чатів платформи (`GET /api/chats`) через `(?3='profile_review' AND …) OR c.workflow_status=?3` читав усі чати власника (≈5 900 рядків на сторінку). Виправлено 2026-10-02 у `lib/chats/list-query.ts`: 150 рядків (своя черга — для «Уточнити профіль»). Лише локальні тести.
- [x] Dashboard (`lib/dashboard-data.ts`) робив `COUNT(*) FROM chats` — виміряно на staging (d1 insights, 2026-10-03): 3 273 рядки/виклик, 8 викликів/добу. Виправлено `SUM(chat_count)` з `chat_queue_counts`: локальний тест — 12 рядків/виклик.
- [x] Telegram warmup (`lib/chats/telegram-warmup.ts`) читав `activity_events` лише з індексом на `user_id` — виміряно на staging: ≈3 128 рядків/виклик (усі акаунти власника), 10 викликів/добу. Виправлено міграцією 0040 (`activity_events_user_account_type_idx` на `(user_id, telegram_account_id, event_type, cancelled_at)`): локальний тест — читає лише свій акаунт.
- [x] «Опубліковано сьогодні» (`chat_publications JOIN chats`, `app/api/chats/route.ts` і `readPublicationState`) фільтрував `c.platform` вже після JOIN — виміряно на staging: 161–168 рядків/виклик на ~3 результати, 336 викликів/добу. Виправлено міграцією 0040 (новий стовпець `chat_publications.platform` + індекс `(user_id, platform, published_on)`, винесено в `lib/chats/daily-links.ts#publishedTodayStatement`); той самий патерн виправлено і в `lib/chats/advertisement-selection.ts` та `app/api/library/route.ts`. Локальний тест підтверджує, що читання чужої (великої) платформи не впливає на вартість запиту цільової.
- [x] `app/api/analytics/route.ts` (розбивка причин архівації) мав `WHERE user_id=?1 AND workflow_status='archived' AND archived_at BETWEEN …` без індексу на `workflow_status` — планувальник ішов `SEARCH` лише по `user_id` й читав усі чати власника, а не лише архівні за період. Знайдено новим тестом-охоронцем (нижче), не було у топі staging на момент перевірки. Виправлено міграцією 0040: `chats_user_status_archived_idx (user_id, workflow_status, archived_at)`; `EXPLAIN QUERY PLAN` підтверджує використання нового індексу з усіма трьома умовами.
- [ ] `lib/chats/daily-links.ts#availableTodayStatement` і подібний запит `eligibleTelegramChats` у `lib/chats/telegram-schedule.ts` виміряно на staging (2026-10-03): 438 і 263 рядки/виклик у середньому (116 і 109 викликів/добу). Індекс уже оптимальний (`chats_user_platform_status_updated_idx`/`chats_user_account_status_updated_idx`, підтверджено `EXPLAIN QUERY PLAN`); вартість пропорційна розміру всієй черги «Готові», а не кількості дійсно вільних чатів, бо `NOT EXISTS`/профільні умови фільтруються вже після індексного скану. Щоб звести це до порядку результату, потрібен окремий read-model (аналог `chat_queue_counts`) для «доступно сьогодні» — не зроблено в цьому коміті, бо це нова абстракція, а не index-фікс.
- [ ] Обхід каналів (`crawlLocalDiscoverySource`, t.me/s, tg.me, lyzem, Brave у `scripts/chat-discovery-source-crawl.mjs`) з 2026-10-02 не викликається runner-ом (джерела — лише Telegram-групи). Код і його тести (частина з 18 падінь `discovery-source-outcomes`) треба видалити окремим кроком.

- [ ] Політика автопошуку для вступлених груп з невідомими критеріями суперечлива: `lib/chat-discovery/inspection.ts` (executor, `requireTargetVerification`) перетворює `review` на `rejected` + `qualification_unverified` і запускає вихід, а вимога 2026-09-29 каже, що incomplete не має видаватися за невідповідність. 2026-10-02 так було залишено групу «Загальний». Потрібне рішення: залишати (fail-closed) чи відкладати й показувати оператору.

- [x] `scripts/whatsapp-web-cdp.mjs`: regex-и всередині template literal (код, який виконується у вкладці через CDP) втрачали escape-послідовності (`\s` → `s`, `\b` → backspace, `\.` → будь-який символ). Виправлено 2026-10-01: подвійні escape, межа слова для кирилиці через `(?![\p{L}\p{N}_])`; регресійний тест `tests/whatsapp-web-cdp-injected-regex.test.mjs` перевіряє всі template literal файлу.

## 4. D1-бюджет і live-канал — що лишилось відкритим (2026-10-04)

Етап — у `docs/ROADMAP.md` (верхній запис), вимоги — DATA-21, AUTO-01…03, SYNC-01…02 у `docs/PRODUCT_REQUIREMENTS.md`.

- [ ] Бюджет ≤ 100 000 рядків/день не підтверджений: знімок `d1 insights` 2026-10-04 (24 год, день розробки й деплоїв) — топ-30 = 227 828 рядків. Найважчі — дії оператора, не опитування: сторінка списку чатів `app/api/chats` (рядок сторінки/пошуку, у середньому 3 361 рядок/виклик, 21 виклик), `app/api/analytics` (`COALESCE(e.chat_id,l.source_chat_id)`, 2 144/виклик), `lib/analytics-trends.ts` (`event_date,event_type,COUNT(*)`, 3 249/виклик), `lib/activity-summary.ts`/`lib/reports/checkpoints.ts` (418/виклик, 56 викликів). Список чатів розібрано й виправлено 2026-10-04 (черга «Уточнити профіль»: 4 003 → 750 рядків локально, див. `docs/DEVELOPMENT_STATUS.md`); переміряти на staging. Аналітику переведено 2026-10-04 на денні лічильники (міграція 0041) і дешевшу розбивку по чатах — локально в 2–13 разів менше рядків; розбивка по чатах і далі пропорційна кількості подій періоду. Переміряти на staging. Переміряти звичайний день після оновлення runner-а.
- [ ] `SELECT id,user_id,last_seen_at FROM chat_discovery_executor_devices` — 357 викликів за ту саму добу (перевірка токена runner-а). Імовірно, старий runner на ПК і/або перепідключення idle-з'єднання без keepalive (додано в 3f). Переміряти після оновлення runner-а; очікувано — кілька викликів на добу.
- [ ] Автопошук (Discovery autonomous run) не запускається з телефона: стан і цикл у sessionStorage вкладки (`components/chat-discovery-dialog.tsx`). Перенести в DO (відкладено планом коміту 3).
- [ ] Інші таймерні звернення до сервера, яких 3f не стосувався, і далі опитують D1: `components/global-timers.tsx` (`/api/timers`, не частіше 120 с), `components/workday-card.tsx` (15–60 с), Viber-джоби в `components/library-workspace.tsx` (до 60 с). Усі обмежені за рядками, але суперечать новому правилу «без таймерного опитування» — перевести на live-канал або подієву перевірку.
- [ ] Lease-колонки `chat_discovery_candidates.executor_lease_*` і `whatsapp_autopost_jobs.executor_device_id/lease_expires_at` більше не пишуться новим кодом, але лишаються в схемі (`active_key` автопосту — не lease, а ключ «одна активна задача на чат», лишається; Viber safe-note jobs і далі мають живий lease). Видалити окремим кроком після живого прийняття (не additive — потрібен окремий дозвіл).
- [ ] Бандл DO `dist/server/owner-channel.js` ~598 КБ (≈85 КБ gzip) через дубль `lib/chat-discovery/seeds.ts` (269 КБ). Ліміт не досягнутий, але варто винести seeds із шляху `applyDiscoveryInspection` → `reconcileDiscoveryRunGoal`.
