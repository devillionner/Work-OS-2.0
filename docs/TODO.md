# TODO

Відомі проблеми, які існували в `main` до 2026-10-01 і поки не виправлені. Push вони не блокують (див. `CLAUDE.md`), але кожна зміна не повинна додавати нових.

## 1. Тести, що падають

- [x] **Закрито 2026-10-05.** Усі 30 відомих падінь (`chat-discovery-cloud.test.mjs` 13 +
  `discovery-source-outcomes.test.mjs` 17) були тестами старого серверного рушія автопошуку
  (до-DO: `startDiscoveryRun`/`continueDiscoveryRun`/`advanceAutonomousDiscoveryRun`/
  `searchLocalDiscoveryPreview`/`discoverPublicWeb`/`discoverTelegramPublic`/web-crawl у
  `chat-discovery-source-crawl.mjs`), який runner більше не викликає. Код і тести видалено
  разом (п. 3 нижче); кілька живих тестів (архівація, membership, виконавча черга, Viber
  leave) переписано на поточний `confirmLocalDiscoveryPreview`. `npm run test:full`:
  **893/893, 0 падінь**. Деталі — `docs/DEVELOPMENT_STATUS.md` (2026-10-05).

## 2. Lint-помилки, приглушені точковими коментарями

27 помилок (24 коментарі) позначено `oxlint-disable-next-line ... -- TODO: потребує зміни логіки/розмітки (docs/TODO.md)`. Виправлення змінює поведінку, тому потребує окремої задачі. Знайти всі: `grep -rn "docs/TODO.md" components`.

- [ ] `react/react-compiler` EffectSetState (setState синхронно в useEffect): `chat-profile-dialog.tsx`, `leads/workspace.tsx`, `library-workspace.tsx`, `platform-workspace.tsx`, `reports-workspace.tsx`, `settings-workspace.tsx`. (`chat-discovery-dialog.tsx` прибрано зі списку 2026-10-05: фікс бага резюму зі старою метою — коміт `b592f35` — замінив саме це `useEffect(setState(...))` на похідне значення в тілі компонента; придушення `oxlint-disable-next-line react/react-compiler` у файлі більше немає, `npm run lint` підтверджує.)
  **ПОПЕРЕДЖЕННЯ (спроба 2026-10-05, відкочено, нічого не закомічено)**: це НЕ однорідний список «забутих» ефектів —
  кожен файл ховає свій навмисний, уже раз полагоджений баг, і наївний фікс ризикує його повернути.
  `chat-profile-dialog.tsx:21-34` — пробував замінити на ключ-ремонт внутрішнього компонента
  (`key={chat.id}`, точно патерн з коміту `6f8317c`) — `tests/workspace-loading-contract.test.mjs:188`
  («dialog and CRM state sync uses props instead of remount keys») одразу це ловить: раніше (коміти
  `6f8317c`→`70076fc`, 2026-09-24) тут БУВ ключ `` `${open}:${chat.id}:${chat.stateToken}` ``, і його
  свідомо прибрали — ремонт на зміну `stateToken` (фонове оновлення чату, поки оператор ще не зберіг
  форму) стирав незбережений ввід. Git-історія (`5d18053`, `04914e7`, `4a73f5a`, `8c691cd`, `11ca5bd`,
  `278895f`) показує той самий клас «remount flicker / втрата вводу» баг через КІЛЬКА компонентів
  (leads/conversation, publish-dialog, settings, global-timers, history-діалоги) — усі виправлені тим
  самим «sync без ремонту» підходом, який і ловить лінтер. `platform-workspace.tsx:128`/
  `settings-workspace.tsx:40` — інший патерн: `useEffect(()=>{if(active)return;setXOpen(false)...})`
  закриває всі модалки вкладки при втраті фокусу — це не похідне значення, а навмисний побічний
  ефект, похідне значення тут не підходить напряму. Перш ніж чіпати БУДЬ-ЯКИЙ з цих 13 придушень:
  `git log --oneline --all | grep -i "remount\|flicker"` і прочитати відповідний коміт — імовірно,
  правильний фікс буде «залишити як є», а не прибрати коментар.
- [ ] `react/react-compiler` Refs (ref.current під час render): `components/leads/workspace.tsx`, `library-workspace.tsx`, `platform-workspace.tsx`.
- [ ] `react/react-compiler` PreserveManualMemo: `components/server-sync.tsx` (`checkRevision`).
- [ ] `react-hooks/exhaustive-deps`: `components/platform-workspace.tsx` (effect з `[filterKey]` без `platform` і `queue`).
- [x] **Частково закрито 2026-10-05.** `jsx-a11y/prefer-tag-over-role` (`role="status"` → `<output>`) у
  `library-workspace.tsx` (4 випадки) і `platform-workspace.tsx` (1, не 2 — старий підрахунок був
  неточний) — пряма заміна тегу безпечна там, де контейнер `display:grid`/`flex` (CSS "blockification"
  flex/grid-елементів — стандарт, не здогадка) або де оригінал уже був `<span>` (inline→inline, без
  зміни). Один вкладений випадок (`library-workspace.tsx`, статус Viber safe-mode) був у звичайному
  block-контейнері — заміна на інлайновий `<output>` змінила б вигляд (full-width банер → вузька
  інлайнова «пігулка»), тож там клас лишився на зовнішньому `<div>`, а голий `<output>` всередині несе
  лише семантику. Лінт/typecheck/build зелені; **живий візуальний тест у браузері не робився** —
  потрібен автентифікований dev-сеанс із конкретними сид-даними (бібліотека з неповним перекладом,
  профільна черга), а CSS-поведінка тут гарантована специфікацією, не припущенням. Якщо колись
  виглядатиме не так — дивись сюди.
  **Лишилось**: `chat-discovery-dialog.tsx:565` — `<details role="status">` (розкривний віджет із
  `<summary>`); `<output>` не може замінити `<details>` без втрати згортання, потрібне інше рішення
  (наприклад, прибрати `role="status"` з `<details>` і обгорнути `<summary>` в окремий `<output>` для
  живого оголошення) — не зроблено, не мало очевидного дрібного фіксу.

## 3. Знайдені баги

- [x] `normalized_link IN (SELECT value FROM json_each(?2))` без платформи перебирав усі рядки власника. Виправлено 2026-10-02 парами `[платформа, посилання]` + `CROSS JOIN json_each` по унікальному індексу `(user_id, platform, normalized_link)`: `prepareLocalPreviews` (7004 → ≤10 рядків), `lib/chat-discovery/domain.ts` (`readExistingCanonicalLinks`, `readExistingCandidates`), `lib/chats/name-enrichment.ts` (20 посилань серед ~5000 чатів — 21 рядок; `EXPLAIN QUERY PLAN`: `SEARCH ... USING INDEX`). Лише локальні тести.
- [x] Список чатів платформи (`GET /api/chats`) через `(?3='profile_review' AND …) OR c.workflow_status=?3` читав усі чати власника (≈5 900 рядків на сторінку). Виправлено 2026-10-02 у `lib/chats/list-query.ts`: 150 рядків (своя черга — для «Уточнити профіль»). Лише локальні тести.
- [x] Dashboard (`lib/dashboard-data.ts`) робив `COUNT(*) FROM chats` — виміряно на staging (d1 insights, 2026-10-03): 3 273 рядки/виклик, 8 викликів/добу. Виправлено `SUM(chat_count)` з `chat_queue_counts`: локальний тест — 12 рядків/виклик.
- [x] Telegram warmup (`lib/chats/telegram-warmup.ts`) читав `activity_events` лише з індексом на `user_id` — виміряно на staging: ≈3 128 рядків/виклик (усі акаунти власника), 10 викликів/добу. Виправлено міграцією 0040 (`activity_events_user_account_type_idx` на `(user_id, telegram_account_id, event_type, cancelled_at)`): локальний тест — читає лише свій акаунт.
- [x] «Опубліковано сьогодні» (`chat_publications JOIN chats`, `app/api/chats/route.ts` і `readPublicationState`) фільтрував `c.platform` вже після JOIN — виміряно на staging: 161–168 рядків/виклик на ~3 результати, 336 викликів/добу. Виправлено міграцією 0040 (новий стовпець `chat_publications.platform` + індекс `(user_id, platform, published_on)`, винесено в `lib/chats/daily-links.ts#publishedTodayStatement`); той самий патерн виправлено і в `lib/chats/advertisement-selection.ts` та `app/api/library/route.ts`. Локальний тест підтверджує, що читання чужої (великої) платформи не впливає на вартість запиту цільової.
- [x] `app/api/analytics/route.ts` (розбивка причин архівації) мав `WHERE user_id=?1 AND workflow_status='archived' AND archived_at BETWEEN …` без індексу на `workflow_status` — планувальник ішов `SEARCH` лише по `user_id` й читав усі чати власника, а не лише архівні за період. Знайдено новим тестом-охоронцем (нижче), не було у топі staging на момент перевірки. Виправлено міграцією 0040: `chats_user_status_archived_idx (user_id, workflow_status, archived_at)`; `EXPLAIN QUERY PLAN` підтверджує використання нового індексу з усіма трьома умовами.
- [ ] `lib/chats/daily-links.ts#availableTodayStatement` і подібний запит `eligibleTelegramChats` у `lib/chats/telegram-schedule.ts` виміряно на staging (2026-10-03): 438 і 263 рядки/виклик у середньому (116 і 109 викликів/добу). Індекс уже оптимальний (`chats_user_platform_status_updated_idx`/`chats_user_account_status_updated_idx`, підтверджено `EXPLAIN QUERY PLAN`); вартість пропорційна розміру всієй черги «Готові», а не кількості дійсно вільних чатів, бо `NOT EXISTS`/профільні умови фільтруються вже після індексного скану. Щоб звести це до порядку результату, потрібен окремий read-model (аналог `chat_queue_counts`) для «доступно сьогодні» — не зроблено в цьому коміті, бо це нова абстракція, а не index-фікс.
- [x] Обхід каналів (`crawlLocalDiscoverySource`, t.me/s, tg.me, lyzem, Brave у `scripts/chat-discovery-source-crawl.mjs`) з 2026-10-02 не викликався runner-ом (джерела — лише Telegram-групи). Видалено 2026-10-05 разом з усім старим до-DO рушієм автопошуку (п. 1 вище) — лишились лише живі `telegramGroupDiscoveryPlan`/`telegramGroupSource`/`workbookSearchPlan`.

- [x] Політика автопошуку для вступлених груп з невідомими критеріями — перевірено 2026-10-04 (читання коду й git-історії): пункт був застарілим, опис описував поведінку ДО коміту `65893d0` (2026-10-02, той самий день, пізніше за інцидент із групою «Загальний»), який саме цей рядок і змінив — `decision: 'rejected'` → `decision: 'review'` (`lib/chat-discovery/inspection.ts`). Невідомі критерії зараз ведуть у `review` з `qualification_unverified`, `needsExternalLeave: false`, вихід у чергу не ставиться; тест `verified executor inspection keeps unverified joined chats in review for the operator instead of leaving` (`tests/chat-discovery-cloud.test.mjs:1465`) це перевіряє і проходить. Рівень доказів — код + локальний тест; живий приклад саме з невідомими критеріями в цьому запуску не траплявся (усі живі результати сесії були однозначні: `target`/`rejected`/`unavailable`/`skipped`).

- [x] `scripts/whatsapp-web-cdp.mjs`: regex-и всередині template literal (код, який виконується у вкладці через CDP) втрачали escape-послідовності (`\s` → `s`, `\b` → backspace, `\.` → будь-який символ). Виправлено 2026-10-01: подвійні escape, межа слова для кирилиці через `(?![\p{L}\p{N}_])`; регресійний тест `tests/whatsapp-web-cdp-injected-regex.test.mjs` перевіряє всі template literal файлу.

## 4. D1-бюджет і live-канал — що лишилось відкритим (2026-10-04)

Етап — у `docs/ROADMAP.md` (верхній запис), вимоги — DATA-21, AUTO-01…03, SYNC-01…02 у `docs/PRODUCT_REQUIREMENTS.md`.

- [ ] Бюджет ≤ 100 000 рядків/день не підтверджений: знімок `d1 insights` 2026-10-04 (24 год, день розробки й деплоїв) — топ-30 = 227 828 рядків. Найважчі — дії оператора, не опитування: сторінка списку чатів `app/api/chats` (рядок сторінки/пошуку, у середньому 3 361 рядок/виклик, 21 виклик), `app/api/analytics` (`COALESCE(e.chat_id,l.source_chat_id)`, 2 144/виклик), `lib/analytics-trends.ts` (`event_date,event_type,COUNT(*)`, 3 249/виклик), `lib/activity-summary.ts`/`lib/reports/checkpoints.ts` (418/виклик, 56 викликів). Список чатів розібрано й виправлено 2026-10-04 (черга «Уточнити профіль»: 4 003 → 750 рядків локально, див. `docs/DEVELOPMENT_STATUS.md`); переміряти на staging. Аналітику переведено 2026-10-04 на денні лічильники (міграція 0041) і дешевшу розбивку по чатах — локально в 2–13 разів менше рядків; розбивка по чатах і далі пропорційна кількості подій періоду. Переміряти на staging. Переміряти звичайний день після оновлення runner-а.
- [ ] `SELECT id,user_id,last_seen_at FROM chat_discovery_executor_devices` — 357 викликів за ту саму добу (перевірка токена runner-а). Імовірно, старий runner на ПК і/або перепідключення idle-з'єднання без keepalive (додано в 3f). Переміряти після оновлення runner-а; очікувано — кілька викликів на добу.
- [x] Автопошук перенесено в DO 2026-10-04 (див. `docs/DEVELOPMENT_STATUS.md`); живе приймання оператором ще попереду.
- [ ] Інші таймерні звернення до сервера, яких 3f не стосувався, і далі опитують D1: `components/global-timers.tsx` (`/api/timers`, не частіше 120 с), `components/workday-card.tsx` (15–60 с), Viber-джоби в `components/library-workspace.tsx` (до 60 с). Усі обмежені за рядками, але суперечать новому правилу «без таймерного опитування» — перевести на live-канал або подієву перевірку.
- [ ] Lease-колонки `chat_discovery_candidates.executor_lease_*` і `whatsapp_autopost_jobs.executor_device_id/lease_expires_at` більше не пишуться новим кодом, але лишаються в схемі (`active_key` автопосту — не lease, а ключ «одна активна задача на чат», лишається; Viber safe-note jobs і далі мають живий lease). Видалити окремим кроком після живого прийняття (не additive — потрібен окремий дозвіл).
- [ ] Бандл DO `dist/server/owner-channel.js` ~598 КБ (≈85 КБ gzip) через дубль `lib/chat-discovery/seeds.ts` (269 КБ). Ліміт не досягнутий, але варто винести seeds із шляху `applyDiscoveryInspection` → `reconcileDiscoveryRunGoal`.
