# Work OS 2.0 — поетапний roadmap

Оновлено: 2026-09-21. Обсяг і статус кожної вимоги — у [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md). Етап завершується за доказами приймання, а не за наявністю екрана. Працюємо напряму в `main` невеликими комітами. Для staging діє Cloudflare Workers Builds: кожен новий push у `main` проходить `npm run verify`, staging-only guard і автоматичний deploy у `work-os-2-staging`. Production лишається окремою явною операцією й не оновлюється цим pipeline. AI й автопостинг не випереджають ручну роботу.

| Етап | Обсяг | Критерії готовності | Стан |
| --- | --- | --- | --- |
| P0. Реєстр і безпечна розробка | Канонічні вимоги, актуальна архітектура, правила D1, verify/CI, контрольований deploy, обмеження polling, відмова від регулярного resync | Усі legacy ID присутні; кожен пункт має статус; суперечності пояснені; lint/tests/build проходять; staging pipeline не може цілитись у production Worker/D1; remote migrations не запускаються від push; GET таймерів не змінює D1 | Готово як основа; підтримується актуальність docs і release metadata |
| P1. Щоденний ручний постинг | CORE/CHAT/IMPORT/TIMER/PUB/PROFILE, ручна частина AD, SCHED-01, UX-02 | Повний шлях додати → приєднати/очікувати → профіль → відкрити чат/скопіювати оголошення → вручну опублікувати → одна подія → архів/відновлення. Telegram-акаунти, черги й розклад ізольовані. Усі обмеження перевіряються сервером. Повернення з месенджера зберігає контекст. Є loading/empty/error/retry/undo там, де безпечно | Functional pre-UX завершено; лишається частина UX/parity acceptance |
| P2. CRM та єдина черга «Сьогодні» | LEAD, CRM-01–04, CAL-02/04, CORE-01/09, SCRIPT/KNOW | Швидке створення неповного ліда; контакт може не навчатися; кілька учнів/уроків; ручний запит куратору; скасування відгуку; джерело/бізнес-дати; Today показує прострочені follow-up та нагадування з переходом до конкретного ліда. Повторна доставка/подвійний клік не створює зайвої події | Core CRM functional pre-UX завершено; contextual scripts, knowledge/version history і CRM message attachments звірені; лишається UX/parity acceptance |
| P3. Звіти, цілі та детальна аналітика | REPORT, ANALYTICS, CAL-01/03, UX-01/03/04, DATA-10/14 | Today, платформи, звіт і аналітика показують однаковий подієвий факт. Ручна корекція видима окремо. Календар/версії/здача/застарілість/історичний контекст працюють. Денні/місячні цілі мають історію. Є довільні періоди, предмети, джерельні події, унікальні ліди та всі записи окремо, когортний і подієвий погляди, атрибуція оголошення/чату, експорт | Functional pre-UX завершено для core reports/analytics; REPORT-22 і subject analytics звірені; лишається решта parity |
| P4. Надійність, UX/visual quality та functional parity | Решта CORE/QA/DATA, OPS-05–07, BACKUP, PAY, PWA/offline | Усі потрібні ручні сценарії реєстру прийняті; таблиця відповідності актуальному Prototype; 10k чатів/10k лідів/100k подій; p95 API <500 мс і UI <1 с на записаному стенді; desktop/mobile/iPhone, keyboard/a11y та visual QA; конфлікти/втрата мережі/reopen/reload/restore; cross-device data sync; безпечне автооновлення клієнта | **Активний етап.** Chromium desktop/tiled/mobile visual hardening, performance evidence, app auto-update і revision-based cross-device sync реалізовані; далі physical iPhone/Safari та remaining reliability/a11y/parity gates |
| P5. Контрольований release та фінальний синхронний перенос | OPS-03/04, MIG, DATA-09/15–17, BACKUP-01/02 | P1–P4 прийняті; production target перевірений окремо; користувач прямо підтвердив остаточний перенос. Одна узгоджена свіжа копія замість щоденного resync; production не очищується; усі відмінності пояснені; є rollback коду та перевірені копії | Заблоковано критеріями parity, не починати |
| P6. AI та додаткова автоматизація | Відкладені PROFILE/AD, LATER, DATA-07, desktop/native push за потреби | Надійний ручний процес прийнято; окремо визначено джерела, приватність, витрати, перегляд і підтвердження. Генерація/автопостинг не змінюють факт публікації до підтвердженого результату. Локальний AI — тільки за новим прямим дозволом | Відкладено |

## Поточний стан P4 — 2026-09-23

- Modal close regression hardening у v0.2.24: shared Dialog deduplicate-ить однаковий open/close transition перед callback і синхронізує controlled state, щоб один X/Escape/backdrop жест не запускав батьківське закриття двічі. Physical Safari/dialog acceptance лишається окремим live gate.

- Linux trial: одна робоча папка, main-only. Перед push — `npm run verify:local` (lint → typecheck → full tests → build); existing staging `verify` є build-only. Виправлено lint regression у reconciliation вимкненої платформи та скидання quick-publish контексту; Discovery не називає ручну перевірку автоматичною. Публікація й live acceptance цього пакета фіксуються окремо в DEVELOPMENT_STATUS.
- Platforms source-level publication/retry/undo/account-context hardening закрито до live gate; наступний автономний пріоритет — Chat Discovery external executor. У v0.2.23 додано owner-scoped executor queue та guarded result callback; v0.2.25 додає secure device pairing, revocation, last-seen і bearer-authenticated executor bridge; v0.2.26 додає device-exclusive 90-second task leases, callback ownership guards і негайне звільнення lease після revoke. У v0.2.27 додано локальний executor companion для реального queue → open messenger → operator-confirmed callback flow. Окремо лишаються fully automated WhatsApp/Viber adapters та live messenger acceptance. Довільний cosmetic refactor не є fallback-пріоритетом.
- Account-context code race закрито у v0.2.20: після вибору іншого Telegram ID не запускається stale reload попереднього ID; новий request-key effect є єдиним reload для switch. Live/two-device publication acceptance лишається наступним Platforms gate.
- Publication Undo deadline parity закрито у v0.2.21: API повертає серверний deadline 8-секундного вікна, а UI прибирає Undo саме за ним, не запускаючи нові 8 секунд після мережевої затримки. Live/two-device acceptance лишається окремим gate.
- Manual publication retry recovery закрито у v0.2.22 на source/UX рівні: publish dialog отримує точний server error, а `refresh:true` stale-state закриває застарілу модалку після reload і змушує оператора відкрити актуальний рядок замість повтору зі старим `stateToken`. Live/network/two-device matrix лишається наступним acceptance gate.

- Manual publication queue hardening: після `published` canonical publication/history/counters лишаються джерелом істини, але ready-list тепер сортує `published_today ASC` перед `updated_at`, тому щойно завершений чат не стрибає нагору й не відсуває наступну робочу дію. UI показує коротке підтвердження, а regression contract фіксує порядок.
- Same-day manual publication correction закрито на code/domain рівні: нові publication events зберігають rollback metadata; 8-секундний Undo використовує fresh state token, видаляє точний manual publication row, ставить publication event у `cancelled_at`, повертає profile `next_allowed_on`, відновлює пов’язаний completed Telegram slot і залишає `undo_published` audit у chat history. Старі events без rollback metadata fail-closed не змінюються автоматично.


- UX-04 закрито shared subject vocabulary: CRM writes/search, chat-direction filters, Library subject tags і Report/Analytics grouping використовують один alias registry; відомі aliases канонізуються, невідомі legacy/custom значення не губляться. CRM subject inputs мають canonical suggestions без закритого select.
- OPS-07 bounded-payload hardening уніфікує mutation body reads через streaming limits до повної алокації; прямі `request.text/json/arrayBuffer/formData` у mutation routes блокуються regression contract. Сам OPS-07 лишається partial до повного session/privacy audit і live acceptance.
- PAY-01..04 закриті одним configurable payment flow у Settings: зарплатний період і дати виплат, незалежні bonus periods для лідів/записів/проведених уроків, калькулятор із canonical event facts та plan/fact/forecast до кінця періоду. Після цього єдиний requirement зі статусом «не реалізовано» — DATA-06 offline outbox/replay; решта P4-gap'ів є partial acceptance/parity/reliability.
- Chat Discovery post-join lifecycle зв’язаний із canonical chat workflow, а v0.2.23 додає executor contract: session-authenticated owner-scoped queue повертає тільки наступну безпечну зовнішню дію (`join_and_inspect`, `check_membership_and_inspect`, `inspect`, `leave`) разом із candidate/chat version tokens. Inspection result і підтверджений WhatsApp/Viber leave застосовуються через існуючі guarded domains; `leave` після зовнішнього успіху узгоджує archive + confirm_leave. Work OS не заявляє зовнішню дію виконаною до callback. Реальний runner/pairing із месенджером ще окремий gap.

- CRM/Analytics parity reconciliation on live staging closed LEAD-17/39/40/41/42 and ANALYTICS-01/04/05/16/19. Remaining Analytics gaps are now the real ones: goals/plan-fact UX, event drill-down/definitions, richer attendance breakdown and publication-level attribution.

- Historical report reconstruction is now closed: `bbdaf24` builds an unsaved past-day draft from canonical events while preserving any existing saved report; read-only staging acceptance passed. REPORT-01/02/04/12/13/15 are now ready.

- Reports calendar acceptance now includes explicit status filters and separate final-submission time; `9d79737` is green on canonical staging and passed a read-only browser smoke. REPORT-06/20 are now closed; physical iPhone/Safari remains separate acceptance.

P4 documentation is source-reconciled against current `main` code and regression contracts on 2026-09-23; publication-flow зміни цього циклу не заявляються як live/staging acceptance. Cloudflare Workers Builds remains the canonical staging gate; each pushed `main` commit must pass `npm run verify` and the staging-only deploy guard before it counts as deployed evidence.

- Reliability/test registry reconciliation закрив OPS-03/06 та QA-03/04/06/07: canonical staging pipeline підтверджений live SHA `d87b992`; performance matrix уже є accepted evidence; controlled-clock timers тепер покривають одночасні deadlines; normalization/duplicate tests охоплюють Telegram/WhatsApp/Viber/Facebook і archive states. Це прибирає застарілі «частково», але не змінює physical Safari/cross-device/offline gates.

- UX/visual hardening після PR #87–#120 та прямих main-фіксів охоплює desktop, tiled/narrow і mobile Chromium. Leads mobile touch-target fixes, responsive hero/simple rows/reminders/action links і Today workday composition уже пройшли staging-перевірку. Physical iPhone/Safari лишається окремим доказом і не замінюється Chromium viewport.
- Workday тепер має start/pause/resume/end, `Повернути день` після випадкового завершення та підтверджуваний `Скинути день` для сьогоднішнього завершеного запису. Reopen зберігає original start/active time; reset видаляє лише workday за сьогодні й не чіпає ліди/чати/уроки/звіти.
- Дані між відкритими клієнтами синхронізуються через монотонний server revision: lightweight `/api/sync` polling у видимому online-вікні, refresh на focus/online та BroadcastChannel між вкладками. Повний RSC refresh відбувається лише після зміни authoritative revision; активний shell/view не повинен скидатися.
- Останній активний розділ Work OS зберігається локально на конкретному браузері/пристрої та відновлюється після reload/повторного відкриття. Це не глобальний user preference між усіма пристроями: кожен пристрій має власний останній екран.
- Відкрита вкладка перевіряє build-id сервера. Коли staging отримує новий build, клієнт показує `Доступне оновлення Work OS` → fullscreen `Оновлюємо Work OS` → автоматичне document reload → `Work OS оновлено`, зберігаючи розділ і scroll. Ручний F5 для застосування нового build не потрібен. Реальний staging-тест happy-path цього UX 2026-09-16 пройдено.
- Підготовка service worker під час автооновлення тепер має 8-секундний timeout. Якщо `registration.update()` не завершується, update flow переходить у вже наявний recovery state `Не вдалося завершити оновлення` з кнопкою `Спробувати ще раз`, замість нескінченного fullscreen spinner. Є regression contract і green staging verify/deploy; окремий live injected-hang drill ще не отримав достовірного результату від browser automation і тому не зарахований як live acceptance.
- Leads writes мають idempotent command body + session journal для невизначеного network outcome: повторна доставка використовує той самий `commandId`, journal переживає reload і очищається лише після definitive response. Stale version повертає 409 `Запис уже змінено. Оновіть картку.`; клієнт перечитує картку і не переграє стару мутацію автоматично. Це покрито regression tests; окремий live offline/reconnect drill лишається acceptance evidence, а не причина змінювати безпечну семантику.
- Backup preview перевіряє schema/counts/ownership/FK та контрольну суму до apply. Restore є missing-only: не видаляє й не перезаписує наявні записи, відхиляє tampered chunk та collision іншого owner, і перед apply вимагає свіжу контрольну копію та окреме підтвердження. Це покрито Miniflare tests; live restore на staging навмисно не запускався без окремої потреби, бо він змінює дані.
- GitHub `main` підключено до Cloudflare Workers Builds для `work-os-2-staging`. Build command: `npm run verify`; deploy command: `npm run deploy:staging`. Guard читає `dist/server/wrangler.json` і відмовляється deploy-ити, якщо Worker не `work-os-2-staging`, D1 не `work-os-2-staging-db` або `CLOUDFLARE_ENV=production`. Після exact-target guard pipeline може застосувати pending migrations лише до staging D1, повторно перевіряє список і тільки тоді deploy-ить Worker. Production migrations цим pipeline недоступні. Старий дублюючий GitHub Actions verify видалено, бо він не отримував runner і створював постійний червоний noise без додаткового захисту.
- Staging deploy робить D1 migration preflight; якщо після exact worker/database-id guard є pending migrations, він застосовує їх лише до `work-os-2-staging-db`, повторює preflight і fail-closed зупиняється, якщо щось лишилось або apply не пройшов. Production target/`CLOUDFLARE_ENV=production` жорстко відхиляється.
- User-facing release metadata зберігається в `lib/app-meta.ts`; кнопка версії в нижній частині навігації та діалог `Що змінилося` повинні оновлюватися разом із релізом. Поточний user-facing release для цього пакета: `v0.2.34`, дата 2026-09-23; source-level executor contract не підміняє live messenger/two-device acceptance.
- Recorded performance matrix покриває 10k chats/profiles/library/leads + 100k events, query/rows/payload/EXPLAIN, staging API p95 і UI action latency; деталі — у `P4_PERFORMANCE.md`. Не повторювати повний performance прогін без зміни query shape/індексів або нового regression.
- Keyboard/a11y walkthrough не підтвердив потребу перетворювати Leads filters на tabs: це toggle-buttons у `fieldset` з `aria-pressed`, а не tablist. Deterministic focus-return тепер реалізований для history dialogs у Leads, lessons, Platforms, Library та Reports через exact trigger refs і regression contracts; physical keyboard/Safari acceptance лишається окремим live доказом.
- Archive/delete/leave parity закрито доменно: permanent delete є лише явно підтвердженим винятком для «Чат не існує», recheck-ить leave policy та відсутність publication/lead/pending-schedule dependencies, лишає audit snapshot і захищений state token/owner guards. CHAT-12/25 підвищені до «готово» після 359/359 local tests і production build; staging acceptance ще виконується canonical pipeline після push.
- Report history має optimistic revision guard для save/restore, bounded line-by-line comparison та завершений календарний heatmap 1/2/3/4+ з незалежними маркерами чернетки/зданого стану. `c46e5ee` пройшов canonical Cloudflare verify/deploy; тестові multi-version записи на staging навмисно не створювали лише заради smoke, бо pure/UI regressions перевіряють mapping без зміни живих даних.
- Реальні gaps не маскуються: offline/outbox, physical Safari/cross-device acceptance, final migration parity та реальний Chat Discovery runner/pairing, який виконає зовнішні дії й поверне результат у вже готовий executor contract. PAY-01..04, CRM message attachments і automatic real chat names уже реалізовані й не є відкритими gaps.

## Найближчий активний етап

1. Довести **Chat Discovery external executor** до реального messenger adapter flow. Для WhatsApp цільова архітектура — browser-first через постійну авторизовану сесію WhatsApp Web без залежності від Desktop app; для Viber — native desktop adapter через системний Viber/deep link. Executor отримує тільки owner-scoped versioned tasks, виконує join/check/inspect/leave та повертає фактичний result callback. Жодна зовнішня дія не позначається виконаною без перевіреного callback.
   - **WhatsApp-only pending approval**: вкладка «Очікування» містить лише запити на вступ, які має підтвердити адміністратор групи. «Перевірити зараз» запускає фактичну перевірку WhatsApp; після adapter acceptance додається також фоновий повторний check. Стани мають розрізняти щонайменше pending / joined / unavailable; у `joined` переводити тільки після фактичного підтвердження, після чого запускати кваліфікацію. Viber цей waiting flow не використовує.
   - Після закриття join/check/inspect/leave acceptance перейти до **autoposting**: спочатку WhatsApp Web adapter, потім Viber desktop adapter, далі shared retry/recovery. Перед send executor зобов’язаний підтвердити identity саме цільового чату; `published` записується тільки після фактично підтвердженої відправки. Невизначений DOM/app state, неправильний чат, admin-only/read-only або інша неоднозначність мають fail-closed без відправлення і без фальшивого publication fact.
2. Провести **cross-device acceptance** на двох реальних клієнтах: телефон ↔ ПК для workday/timers/Leads/Platforms та хоча б однієї зміни Reports/Settings. Перевірити latency, stale conflict і відсутність розбіжності після повторного focus/reload.
3. Провести окремий **physical iPhone/Safari** acceptance: safe areas, touch, virtual keyboard, deep links, dialogs, sticky controls, responsive composition та auto-update UX. Chromium mobile не зараховувати як доказ Safari.
4. Дозакрити live accessibility/reliability evidence, яке не можна чесно замінити contract tests: physical keyboard/Safari walkthrough для focus-return, offline/reconnect walkthrough та injected update-failure recovery. Exact history-dialog focus targets, 409/idempotency, reopen/reload і backup/restore safety вже мають code/test evidence; restore-drill не запускати лише заради галочки, якщо для цього треба змінювати staging data.
5. Продовжувати синхронізувати PRODUCT_REQUIREMENTS лише з фактичними доказами; REPORT-09/21/22 звірені 2026-09-18 по code/test evidence. Сформувати фінальний parity gap list перед P5.
6. Не брати без окремого рішення: offline outbox/PWA promises та final production cutover. PAY-01..04 і CRM message attachments уже входять у поточний Work OS; Chat Discovery/operator automation лишається погодженим scope; production — тільки після окремого прямого дозволу.

## Gate кожного коміту й push

- Достатньо конкретний обсяг, без змін Prototype Checker.
- Релевантні доменні/regression перевірки для ризикової логіки; проста текстова/візуальна зміна не потребує тесту, який лише дублює реалізацію.
- `npm run verify` = lint → tests → build. У staging pipeline цей gate виконує Cloudflare Workers Builds перед deploy.
- Push у `main` **означає автоматичний staging build/deploy**, якщо verify та staging guard пройшли. Це не означає production deploy.
- Cloudflare Workers Builds є єдиним staging pre-deploy verify/deploy gate; не тримати окремий дублюючий GitHub Actions workflow без конкретної додаткової перевірки.
- Звичайний push може застосувати лише pending SQL migrations до exact staging D1 після staging guard. Жодних production migrations/writes, resync або restore-drill від звичайного push.
- User-facing `APP_VERSION`, release date і `APP_CHANGES` оновлюються на кожен змістовний user-visible реліз, щоб кнопка версії не відставала від фактичного staging/production UI.
- Статус requirement змінюється тільки з доказами; код або один screenshot самі по собі не означають повний acceptance.

## Gate staging release

1. Cloudflare Workers Builds бере `main`, запускає `npm run verify`, збирає `dist/server/wrangler.json` і лише потім запускає `npm run deploy:staging`.
2. `scripts/deploy-staging.mjs` повинен підтвердити Worker `work-os-2-staging`, D1 `work-os-2-staging-db`, очікуваний database ID та відсутність production environment. Якщо guard не проходить — deploy зупиняється.
3. Після exact staging guard `scripts/deploy-staging.mjs` може автоматично застосувати pending SQL migrations лише до `work-os-2-staging-db`, повторно перевіряє remote migration state і лише тоді продовжує deploy. Production migrations цим pipeline недоступні.
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

## Platforms responsive acceptance — 2026-09-23

- v0.2.34 corrects daily join semantics: an archived/returned unusable chat no longer counts in «Приєднано сьогодні» or joined analytics; restore alone does not re-count it, while a real same-day rejoin can activate the fact again.
- v0.2.33 removes the remaining same-view flash at the shell boundary: Platforms is no longer keyed/remounted by `syncRevision`; revision changes trigger a silent canonical reload inside the mounted workspace instead.
- v0.2.32 removes the full queue blank/reappear cycle during same-view mutations: current data stays mounted while the server reconciliation runs, and the full loader is used only when there is no matching current dataset.
- v0.2.31 replaces viewport-only queue adaptation with container-responsive layout and max-content chat rows, covering narrow workspace widths created by the persistent sidebar or tiled browser windows. Queue tabs also collapse to two columns when the actual browser panel becomes compact.
- v0.2.30 moves archive-reason selection into a modal so opening archive cannot overlap or hide controls behind the next chat row. Archive failures stay visible in-context and stale-state reload/retry keeps the canonical state token.
- v0.2.29 closes the observed narrow-desktop overflow in Platforms: at <=1180px chat rows stack actions below chat identity, toolbar search takes a full row, profile counters wrap, and native links cannot exceed the available width. This is source/regression evidence; physical browser acceptance remains part of the live UX gate.

## Messenger automation decisions — 2026-09-23

- v0.2.28: WhatsApp-only «Очікування» отримує окремий server-filtered список і лічильник; pending WhatsApp membership задачі мають пріоритет у executor queue. Це саме flow запитів, які має підтвердити адміністратор групи, а не загальний platform filter.
- WhatsApp runtime target — **WhatsApp Web у браузері**, без вимоги окремого Desktop app. Майбутній adapter має працювати з постійною авторизованою web-сесією, фактично перевіряти pending/joined/unavailable та ніколи не виводити стан із самого факту відкриття invite.
- Для WhatsApp «Перевірити зараз» лишається явною ручною дією, а після live acceptance adapter має також уміти безпечно повторно перевіряти pending membership у фоні. Після підтвердженого `joined` запускається звичайна кваліфікація; непридатний чат проходить canonical leave + archive.
- Viber не використовує WhatsApp pending-approval queue. На Linux/CachyOS reference environment системно інтегрований Viber відкриває invite напряму через `viber.desktop` / `x-scheme-handler/viber`; AppImage не є цільовою залежністю. Для Viber executor flow — open/join-or-open → inspect → qualify/leave.
- Autoposting іде наступним operator-automation slice після messenger-side Discovery acceptance: **WhatsApp Web → Viber desktop → shared retry/recovery**. Перед відправленням adapter має перевірити, що відкрито саме target chat; після відправлення — підтвердити фактичний send. Будь-яка невизначеність fail-closed: не відправляти і не ставити `published`.

- v0.2.35: Platforms archive-reason dialog uses native fieldset/legend semantics while preserving responsive touch targets; UX regression coverage guards the accessible grouping.


## Publication consistency acceptance — v0.2.36

- [x] Server-confirmed publication/Undo returns an authoritative Platforms snapshot and reconciles visible counters/state immediately.
- [x] Publication/Undo broadcasts an all-scope revision refresh for Today, Reports, Analytics and Library; Platforms remains mounted and silently reconciles.
- [x] Cross-tab/cross-device revision handling does not consume throttled revisions without a refresh.
- [x] Europe/Kyiv day rollover refreshes daily read-models even without a mutation.
- [x] Regression coverage guards atomic publication/event facts, cancellation, report revisions, Library reuse state, Telegram scheduler restore/account isolation and archive-history preservation.
- [ ] Final staging full-gate acceptance for v0.2.36: `verify:local` + guarded deploy + `/api/build` must match the release HEAD/version before this slice is called deployed.
- Library advertisement UX cleanup started in v0.2.37: platform filter + visible platform badges + responsive mobile toolbar are implemented with regression coverage. Next data slice: normalize/validate advertisement platform metadata and reuse visibility; then Viber autopost safe mode to «Мої нотатки».
