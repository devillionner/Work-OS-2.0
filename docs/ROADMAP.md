# Work OS 2.0 — поетапний roadmap

Оновлено: 2026-09-20. Обсяг і статус кожної вимоги — у [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md). Етап завершується за доказами приймання, а не за наявністю екрана. Працюємо напряму в `main` невеликими комітами. Для staging діє Cloudflare Workers Builds: кожен новий push у `main` проходить `npm run verify`, staging-only guard і автоматичний deploy у `work-os-2-staging`. Production лишається окремою явною операцією й не оновлюється цим pipeline. AI й автопостинг не випереджають ручну роботу.

| Етап | Обсяг | Критерії готовності | Стан |
| --- | --- | --- | --- |
| P0. Реєстр і безпечна розробка | Канонічні вимоги, актуальна архітектура, правила D1, verify/CI, контрольований deploy, обмеження polling, відмова від регулярного resync | Усі legacy ID присутні; кожен пункт має статус; суперечності пояснені; lint/tests/build проходять; staging pipeline не може цілитись у production Worker/D1; remote migrations не запускаються від push; GET таймерів не змінює D1 | Готово як основа; підтримується актуальність docs і release metadata |
| P1. Щоденний ручний постинг | CORE/CHAT/IMPORT/TIMER/PUB/PROFILE, ручна частина AD, SCHED-01, UX-02 | Повний шлях додати → приєднати/очікувати → профіль → відкрити чат/скопіювати оголошення → вручну опублікувати → одна подія → архів/відновлення. Telegram-акаунти, черги й розклад ізольовані. Усі обмеження перевіряються сервером. Повернення з месенджера зберігає контекст. Є loading/empty/error/retry/undo там, де безпечно | Functional pre-UX завершено; лишається частина UX/parity acceptance |
| P2. CRM та єдина черга «Сьогодні» | LEAD, CRM-01–04, CAL-02/04, CORE-01/09, SCRIPT/KNOW | Швидке створення неповного ліда; контакт може не навчатися; кілька учнів/уроків; ручний запит куратору; скасування відгуку; джерело/бізнес-дати; Today показує прострочені follow-up та нагадування з переходом до конкретного ліда. Повторна доставка/подвійний клік не створює зайвої події | Core CRM functional pre-UX завершено; contextual scripts і knowledge/version history звірені; CRM media лишається окремим scope |
| P3. Звіти, цілі та детальна аналітика | REPORT, ANALYTICS, CAL-01/03, UX-01/03/04, DATA-10/14 | Today, платформи, звіт і аналітика показують однаковий подієвий факт. Ручна корекція видима окремо. Календар/версії/здача/застарілість/історичний контекст працюють. Денні/місячні цілі мають історію. Є довільні періоди, предмети, джерельні події, унікальні ліди та всі записи окремо, когортний і подієвий погляди, атрибуція оголошення/чату, експорт | Functional pre-UX завершено для core reports/analytics; REPORT-22 і subject analytics звірені; лишається решта parity |
| P4. Надійність, UX/visual quality та functional parity | Решта CORE/QA/DATA, OPS-05–07, BACKUP, PAY, PWA/offline | Усі потрібні ручні сценарії реєстру прийняті; таблиця відповідності актуальному Prototype; 10k чатів/10k лідів/100k подій; p95 API <500 мс і UI <1 с на записаному стенді; desktop/mobile/iPhone, keyboard/a11y та visual QA; конфлікти/втрата мережі/reopen/reload/restore; cross-device data sync; безпечне автооновлення клієнта | **Активний етап.** Chromium desktop/tiled/mobile visual hardening, performance evidence, app auto-update і revision-based cross-device sync реалізовані; далі physical iPhone/Safari та remaining reliability/a11y/parity gates |
| P5. Контрольований release та фінальний синхронний перенос | OPS-03/04, MIG, DATA-09/15–17, BACKUP-01/02 | P1–P4 прийняті; production target перевірений окремо; користувач прямо підтвердив остаточний перенос. Одна узгоджена свіжа копія замість щоденного resync; production не очищується; усі відмінності пояснені; є rollback коду та перевірені копії | Заблоковано критеріями parity, не починати |
| P6. AI та додаткова автоматизація | Відкладені PROFILE/AD, LATER, DATA-07, desktop/native push за потреби | Надійний ручний процес прийнято; окремо визначено джерела, приватність, витрати, перегляд і підтвердження. Генерація/автопостинг не змінюють факт публікації до підтвердженого результату. Локальний AI — тільки за новим прямим дозволом | Відкладено |

## Поточний стан P4 — 2026-09-20

- Reports calendar acceptance now includes explicit status filters and separate final-submission time; `9d79737` is green on canonical staging and passed a read-only browser smoke. REPORT-06/20 are now closed; physical iPhone/Safari remains separate acceptance.

P4 documentation is reconciled against the current code and tests on 2026-09-20. Cloudflare Workers Builds remains the canonical staging gate; each pushed `main` commit must pass `npm run verify` and the staging-only deploy guard before it counts as deployed evidence.

- UX/visual hardening після PR #87–#120 та прямих main-фіксів охоплює desktop, tiled/narrow і mobile Chromium. Leads mobile touch-target fixes, responsive hero/simple rows/reminders/action links і Today workday composition уже пройшли staging-перевірку. Physical iPhone/Safari лишається окремим доказом і не замінюється Chromium viewport.
- Workday тепер має start/pause/resume/end, `Повернути день` після випадкового завершення та підтверджуваний `Скинути день` для сьогоднішнього завершеного запису. Reopen зберігає original start/active time; reset видаляє лише workday за сьогодні й не чіпає ліди/чати/уроки/звіти.
- Дані між відкритими клієнтами синхронізуються через монотонний server revision: lightweight `/api/sync` polling у видимому online-вікні, refresh на focus/online та BroadcastChannel між вкладками. Повний RSC refresh відбувається лише після зміни authoritative revision; активний shell/view не повинен скидатися.
- Останній активний розділ Work OS зберігається локально на конкретному браузері/пристрої та відновлюється після reload/повторного відкриття. Це не глобальний user preference між усіма пристроями: кожен пристрій має власний останній екран.
- Відкрита вкладка перевіряє build-id сервера. Коли staging отримує новий build, клієнт показує `Доступне оновлення Work OS` → fullscreen `Оновлюємо Work OS` → автоматичне document reload → `Work OS оновлено`, зберігаючи розділ і scroll. Ручний F5 для застосування нового build не потрібен. Реальний staging-тест happy-path цього UX 2026-09-16 пройдено.
- Підготовка service worker під час автооновлення тепер має 8-секундний timeout. Якщо `registration.update()` не завершується, update flow переходить у вже наявний recovery state `Не вдалося завершити оновлення` з кнопкою `Спробувати ще раз`, замість нескінченного fullscreen spinner. Є regression contract і green staging verify/deploy; окремий live injected-hang drill ще не отримав достовірного результату від browser automation і тому не зарахований як live acceptance.
- Leads writes мають idempotent command body + session journal для невизначеного network outcome: повторна доставка використовує той самий `commandId`, journal переживає reload і очищається лише після definitive response. Stale version повертає 409 `Запис уже змінено. Оновіть картку.`; клієнт перечитує картку і не переграє стару мутацію автоматично. Це покрито regression tests; окремий live offline/reconnect drill лишається acceptance evidence, а не причина змінювати безпечну семантику.
- Backup preview перевіряє schema/counts/ownership/FK та контрольну суму до apply. Restore є missing-only: не видаляє й не перезаписує наявні записи, відхиляє tampered chunk та collision іншого owner, і перед apply вимагає свіжу контрольну копію та окреме підтвердження. Це покрито Miniflare tests; live restore на staging навмисно не запускався без окремої потреби, бо він змінює дані.
- GitHub `main` підключено до Cloudflare Workers Builds для `work-os-2-staging`. Build command: `npm run verify`; deploy command: `npm run deploy:staging`. Guard читає `dist/server/wrangler.json` і відмовляється deploy-ити, якщо Worker не `work-os-2-staging`, D1 не `work-os-2-staging-db` або `CLOUDFLARE_ENV=production`. Remote migrations не запускаються цим pipeline. Старий дублюючий GitHub Actions verify видалено, бо він не отримував runner і створював постійний червоний noise без додаткового захисту.
- User-facing release metadata зберігається в `lib/app-meta.ts`; кнопка версії в нижній частині навігації та діалог `Що змінилося` повинні оновлюватися разом із релізом. Поточний user-facing release: `v0.2.6`, дата 2026-09-20.
- Recorded performance matrix покриває 10k chats/profiles/library/leads + 100k events, query/rows/payload/EXPLAIN, staging API p95 і UI action latency; деталі — у `P4_PERFORMANCE.md`. Не повторювати повний performance прогін без зміни query shape/індексів або нового regression.
- Keyboard/a11y walkthrough не підтвердив потребу перетворювати Leads filters на tabs: це toggle-buttons у `fieldset` з `aria-pressed`, а не tablist. Deterministic focus-return тепер реалізований для history dialogs у Leads, lessons, Platforms, Library та Reports через exact trigger refs і regression contracts; physical keyboard/Safari acceptance лишається окремим live доказом.
- Archive/delete/leave parity закрито доменно: permanent delete є лише явно підтвердженим винятком для «Чат не існує», recheck-ить leave policy та відсутність publication/lead/pending-schedule dependencies, лишає audit snapshot і захищений state token/owner guards. CHAT-12/25 підвищені до «готово» після 359/359 local tests і production build; staging acceptance ще виконується canonical pipeline після push.
- Report history тепер має optimistic revision guard для save/restore та bounded line-by-line comparison старої версії з поточною. `df8c114` і `e36c554` пройшли canonical Cloudflare verify/deploy; live `/api/build` підтвердив `e36c554`. Поточний read-only staging dataset має лише `revisionCount=1` для наявних денних звітів, тому тестову другу версію навмисно не створювали лише заради smoke.
- Реальні gaps не маскуються: automatic real chat names, CRM media, PAY, offline/outbox, physical Safari/cross-device acceptance та final migration parity.

## Найближчий активний етап

1. Провести **cross-device acceptance** на двох реальних клієнтах: телефон ↔ ПК для workday/timers/Leads/Platforms та хоча б однієї зміни Reports/Settings. Перевірити latency, stale conflict і відсутність розбіжності після повторного focus/reload.
2. Провести окремий **physical iPhone/Safari** acceptance: safe areas, touch, virtual keyboard, deep links, dialogs, sticky controls, responsive composition та auto-update UX. Chromium mobile не зараховувати як доказ Safari.
3. Дозакрити live accessibility/reliability evidence, яке не можна чесно замінити contract tests: physical keyboard/Safari walkthrough для focus-return, offline/reconnect walkthrough та injected update-failure recovery. Exact history-dialog focus targets, 409/idempotency, reopen/reload і backup/restore safety вже мають code/test evidence; restore-drill не запускати лише заради галочки, якщо для цього треба змінювати staging data.
4. Продовжувати синхронізувати PRODUCT_REQUIREMENTS лише з фактичними доказами; REPORT-09/21/22 звірені 2026-09-18 по code/test evidence. Сформувати фінальний parity gap list перед P5.
5. Не брати без окремого рішення: automatic real chat-name fetching, CRM media storage, PAY, offline outbox/PWA promises, AI/autoposting та final production cutover.

## Gate кожного коміту й push

- Достатньо конкретний обсяг, без змін Prototype Checker.
- Релевантні доменні/regression перевірки для ризикової логіки; проста текстова/візуальна зміна не потребує тесту, який лише дублює реалізацію.
- `npm run verify` = lint → tests → build. У staging pipeline цей gate виконує Cloudflare Workers Builds перед deploy.
- Push у `main` **означає автоматичний staging build/deploy**, якщо verify та staging guard пройшли. Це не означає production deploy.
- Cloudflare Workers Builds є єдиним staging pre-deploy verify/deploy gate; не тримати окремий дублюючий GitHub Actions workflow без конкретної додаткової перевірки.
- Жодних remote migrations, resync, restore-drill або production writes від звичайного push.
- User-facing `APP_VERSION`, release date і `APP_CHANGES` оновлюються на кожен змістовний user-visible реліз, щоб кнопка версії не відставала від фактичного staging/production UI.
- Статус requirement змінюється тільки з доказами; код або один screenshot самі по собі не означають повний acceptance.

## Gate staging release

1. Cloudflare Workers Builds бере `main`, запускає `npm run verify`, збирає `dist/server/wrangler.json` і лише потім запускає `npm run deploy:staging`.
2. `scripts/deploy-staging.mjs` повинен підтвердити Worker `work-os-2-staging`, D1 `work-os-2-staging-db`, очікуваний database ID та відсутність production environment. Якщо guard не проходить — deploy зупиняється.
3. Міграції D1 не входять у staging auto-deploy. Якщо зміна потребує SQL migration, вона виконується окремим контрольованим кроком із явною ціллю staging.
4. Після успішного staging deploy — короткий smoke check потрібного сценарію. Для release/update змін окремо перевірити `/api/build`, update UX та повернення до попереднього view.
5. Production Worker/D1 не змінюються staging pipeline.

## Gate контрольованого production release

1. Зафіксувати конкретний commit, результати verify, список SQL-міграцій, rollback версію та production Worker/D1 target.
2. Production не використовує staging-only `deploy:staging`. Потрібен окремий explicit target/dry-run і прямий дозвіл користувача на конкретний release.
3. Environment обирається до build; перевіряється згенерований `dist/server/wrangler.json`. Не покладатися лише на пізній `--env production`.
4. SQL migrations/дані — окрема операція від Worker deploy. Не запускати auto-migration разом із push.
5. Після release — короткий read-only health/smoke check. При проблемі rollback Worker code; не робити автоматичний downgrade/очищення D1.

## Gate фінального переносу

- Функціональна відповідність перевірена за актуальним read-only Prototype та PRODUCT_REQUIREMENTS; нові вимоги додаються з ID, дані щоденно не синхронізуються.
- Пряме підтвердження користувача стосується конкретного snapshot, цілі та погодженого вікна переносу.
- Зберегти свіжий повний вихідний backup і поточний Work OS backup, hash/version/counts. Відомі totals зі старого CUTOVER не використовувати як сьогоднішні.
- Локально виконати dry-run/mapper/restore і порівняти counts, IDs, усі поля, зв’язки, події, unknown/raw keys, account ownership, цілі та звіти. Відсутність запису у джерелі не означає видалення в цілі.
- Розглянути всі managed/conflicting records; не обходити guard і не перезапускати імпорт навмання. Визначити очікувані existing/missing/conflict результати кожної порції.
- Провести один погоджений перенос з resumable progress і обмеженою перевіркою. Повтор — лише для конкретного невдалого кроку з поясненням.
- Порівняти фінальні дані/події, зробити дві успішні перевірені копії нової бази за період реальної роботи. Prototype зберігається; його видалення/виведення з експлуатації потребує окремого рішення.

## UX / reliability decisions — 2026-09-16

- Main navigation має один Settings entry; version/release button лишається окремим utility control і завжди показує актуальний `APP_VERSION` та поточні release notes.
- Auto-update є керованим document reload, а не небезпечним hot-swap JS/CSS: користувач не тисне F5, бачить update UI і повертається в той самий контекст.
- Cross-device sync і app-version update — різні механізми. Data sync перечитує authoritative D1 state при зміні revision; app update замінює вже запущений JS/CSS після нового build-id.
- Server/D1 є source of truth. Локальний клієнт не перемагає authoritative version при stale conflict.
- Workday reset є destructive дією тільки для сьогоднішнього завершеного workday та має підтвердження; reopen — недеструктивний recovery path.
- Physical Safari/iPhone, offline/outbox і production cutover лишаються окремими acceptance gates.
