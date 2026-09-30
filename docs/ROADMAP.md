## 2026-09-30 — Discovery compact run data layout (v0.2.78)

- [x] Run data uses two balanced rows: Plan/Duplicates and WhatsApp/Activity.
- [x] Short labels and slash notation prevent the activity time from wrapping alone on the narrow sidebar.
- [x] Search behavior and stored state are unchanged.

## 2026-09-30 — Discovery transient source warning (v0.2.77)

- [x] Source cooldown warning renders only while autonomous search is actively running.
- [x] Pause and resume clear stale sourceIssues/sourceFailures so an old cooldown cannot remain in the modal.
- [x] Active source failures remain visible while actionable; factual search state and outcomes are unchanged.

## 2026-09-30 — Discovery UI trim (v0.2.76)

- [x] Ручний блок «Додаткове джерело Telegram» повністю прибрано з operator modal; автономний Telegram source crawl не змінено.
- [x] «Технічні дані запуску» спрощено до компактних «Даних пошуку».
- [x] Пошукові кроки й live seconds-ago countdown прибрано; остання активність показується звичайним часом HH:mm.
- [x] Functional discovery flow, D1 contract, dedupe та qualification criteria не змінювалися.

## 2026-09-30 — Discovery focus-first UI/UX (v0.2.75)

- [x] Модалка перебудована навколо однієї мети: прогрес до потрібної кількості цільових чатів, людський поточний статус і одна головна дія.
- [x] Шість повторних stat tiles замінено трьома короткими сигналами; сім вкладок скорочено до «Зараз», «Потрібен мій погляд», «Цільові», «Історія».
- [x] Query/cursor/source errors та інші службові дані більше не конкурують з основним workflow: вони доступні лише в розкривній діагностиці.
- [x] Картки тепер починаються з назви, пояснення стану й primary actions; робочі критерії та джерела розкриваються за потреби.
- [x] Збережено dedupe, direct actions, factual qualification і mobile-safe dialog/touch targets.

## 2026-09-30 — Discovery UI/UX cleanup + unique results (v0.2.74)

- [x] Browser-local outcome і вже збережений candidate з тим самим canonical platform + invite більше не рендеряться як два різні чати; persisted row має пріоритет для operator actions.
- [x] Лічильники результатів не додають повторно той самий durable outcome; новий browser-local результат додається поверх останнього workspace snapshot лише доки snapshot ще не містить його.
- [x] «Поточний запуск» і загальна історія тепер візуально розділені: зрозумілі Знайдено invite / У перевірці / Ручна перевірка / Цільові / Відсіяно / Дублі / відомі, контекстні empty states і шість рівних stat tiles на wide desktop.
- [x] Primary actions для review/target винесені прямо на картку; dead local-review CTA прибраний.
- [x] Dialog width тепер прив'язаний до dynamic viewport width, тому narrow/mobile не розтягує модалку за межі екрана; ключові touch actions мають mobile-safe hit targets.
- [x] Regression contract захищає canonical merge/dedupe, direct review actions, responsive summary/dialog width і contextual empty states.

**Roadmap decision:** P4-A лишається функціонально закритим. P4-A-PERF (fresh-source yield ≥12 confirmed targets/hour, goal-50 soak, D1 cold/warm acceptance) лишається окремим non-blocking backlog. Наступний активний functional slice — **P4-B confirmed-send WhatsApp autopost**.

## 2026-09-29 — P4-A WhatsApp Discovery functional closure

**Decision:** P4-A is closed as an operator-usable functional workflow. The measured source-yield objective is split into a separate **P4-A-PERF** backlog and no longer blocks the next functional roadmap slice.

Physical acceptance on exact code/runtime `a25653d9d9a878afc2e3455461637443927b2ce6`:
- staging `/api/build` returned the exact same SHA; the workstation service was active and its three runtime script blobs matched GitHub `main` byte-for-byte;
- live run `56448714-2f0b-4b75-938c-ae4a255eb6d0`, goal 1: source plan 2,391 tasks, cursor 1,215, 6,026 source attempts, 65 invite hits processed, 54 duplicates, 8 factual rejects, 2 approval-required skips, 1 unavailable invalid invite, 1 manual-review fresh join, 0 confirmed targets;
- `Загальний`: joined, 702 members, topic match, writable → correctly finalized as `review` with `fresh_join_history_unavailable + unknown_ads_allowed + unknown_activity`; it was not falsely called target/rejected/unavailable and is not automatically rejoined;
- `Bali Ukraine | Балі Україна`: 24 members, cannot write → factual reject; hard criteria remain unchanged.

Functional closure criteria now accepted:
- [x] local-first source search + durable dedupe;
- [x] explicit UI start/stop/resume without destructive pause archiving;
- [x] exact WhatsApp target/join/pending/fail-closed lifecycle with bounded retries and recovery;
- [x] joined-chat requalification reuses joined identity/group ID and does not repeat join;
- [x] fresh joins without pre-join history go to manual review instead of false rejection or indefinite waiting;
- [x] factual rejects/skips/unavailable remain durable dedupe anchors; unknown facts do not trigger destructive leave;
- [x] multi-candidate live run and exact staging/runtime identity verified.

### P4-A-PERF — non-blocking performance backlog
- [ ] measured source yield ≥12 newly confirmed targets/hour (≈1/5 min);
- [ ] improve fresh unique qualifying invite supply; latest accepted run produced 0 confirmed targets;
- [ ] default goal 50 soak run to target or honest `sources_exhausted`;
- [ ] D1 cold/warm rows_read acceptance remains an ops/performance check, not a Discovery correctness blocker.

Do not reopen P4-A functional correctness merely because external source yield is below the performance objective. Reopen only for a regression in join/qualification/dedupe/pause/recovery semantics.

## 2026-09-29 — measured source supply remains the blocker
- Verified exact staging and workstation code at 507378c before the run.
- UI-started/resumed run measured 57 found invites, all duplicates, zero new candidates and zero targets in 291.945 seconds. Progress retained on UI stop.
- Implemented source/checkpoint concurrency protection and shared search cooldown with visible degraded-source warnings; two focused behavioral tests pass.
- [ ] Fresh qualifying supply and the 12-target/hour acceptance remain unproven. Do not count search attempts or duplicates as progress toward this gate.

## 2026-09-29 — GO-LIVE-04/06/08 reliability package
- Implemented bounded retries, joined-chat reinspection, persistence-only retry, shared runtime deadline, current-state result merge, non-destructive pause and explicit incomplete-result recovery.
- Implemented empty-directory web fallback, successful-read source dedupe, graph outcome feedback and candidate timing/reason metrics.
- Seven focused behavioral regressions passed in memory; syntax checks passed. Full verify:local not executed.
- [ ] Exact staging identity, refreshed runtime and real target acceptance.
- [ ] Measured one-hour yield of 12 new factual targets; no guarantee or gate closure inferred from code/test results.

# Work OS 2.0 — поетапний roadmap

Оновлено: 2026-09-30. Обсяг і статус кожної вимоги — у [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md). Етап завершується за доказами приймання, а не за наявністю екрана. Працюємо напряму в `main` невеликими комітами. Для staging діє Cloudflare Workers Builds: кожен новий push у `main` проходить production build через `npm run verify`, staging-only guard і автоматичний deploy у `work-os-2-staging`. Повний `verify:local` (lint → typecheck → full tests → build) є окремим pre-release gate і не дублюється всередині Workers Builds. Production лишається окремою явною операцією й не оновлюється цим pipeline. Ручний workflow лишається recovery/fallback, але активний пріоритет визначається functional value: WhatsApp/Discovery automation має скорочувати реальну операторську роботу; AI-генерація не випереджає цей functional automation baseline.

| Етап | Обсяг | Критерії готовності | Стан |
| --- | --- | --- | --- |
| P0. Реєстр і безпечна розробка | Канонічні вимоги, актуальна архітектура, правила D1, verify/CI, контрольований deploy, обмеження polling, відмова від регулярного resync | Усі legacy ID присутні; кожен пункт має статус; суперечності пояснені; lint/tests/build проходять; staging pipeline не може цілитись у production Worker/D1; remote migrations не запускаються від push; GET таймерів не змінює D1 | Готово як основа; підтримується актуальність docs і release metadata |
| P1. Щоденний ручний постинг | CORE/CHAT/IMPORT/TIMER/PUB/PROFILE, ручна частина AD, SCHED-01, UX-02 | Повний шлях додати → приєднати/очікувати → профіль → відкрити чат/скопіювати оголошення → вручну опублікувати → одна подія → архів/відновлення. Telegram-акаунти, черги й розклад ізольовані. Усі обмеження перевіряються сервером. Повернення з месенджера зберігає контекст. Є loading/empty/error/retry/undo там, де безпечно | Functional pre-UX завершено; лишається частина UX/parity acceptance |
| P2. CRM та єдина черга «Сьогодні» | LEAD, CRM-01–04, CAL-02/04, CORE-01/09, SCRIPT/KNOW | Швидке створення неповного ліда; контакт може не навчатися; кілька учнів/уроків; ручний запит куратору; скасування відгуку; джерело/бізнес-дати; Today показує прострочені follow-up та нагадування з переходом до конкретного ліда. Повторна доставка/подвійний клік не створює зайвої події | Core CRM functional pre-UX завершено; contextual scripts, knowledge/version history і CRM message attachments звірені; лишається UX/parity acceptance |
| P3. Звіти, цілі та детальна аналітика | REPORT, ANALYTICS, CAL-01/03, UX-01/03/04, DATA-10/14 | Today, платформи, звіт і аналітика показують однаковий подієвий факт. Ручна корекція видима окремо. Календар/версії/здача/застарілість/історичний контекст працюють. Денні/місячні цілі мають історію. Є довільні періоди, предмети, джерельні події, унікальні ліди та всі записи окремо, когортний і подієвий погляди, атрибуція оголошення/чату, експорт | Functional pre-UX завершено для core reports/analytics; REPORT-22 і subject analytics звірені; лишається решта parity |
| P4. Functional automation + reliability/parity | WhatsApp Web executor, pending approval, Chat Discovery lifecycle, WhatsApp confirmed-send autopost; решта CORE/QA/DATA, OPS-05–07, BACKUP, PAY, PWA/offline | Спочатку відсутні operator workflows доведені end-to-end: invite → join/check → pending recheck → qualification → workflow/archive/leave; далі WhatsApp send із exact-target verification і publication fact тільки після confirmed send. Reliability/UX/QA є gates усередині цих slices, а не заміною функціональної реалізації. Після functional backlog — physical Safari/cross-device/offline/a11y acceptance. | **Активний етап. FUNCTIONAL VALUE FIRST.** P4-A Discovery функціонально закритий; активний наступний результат — confirmed-send WhatsApp autopost. P4-A-PERF лишається окремим non-blocking backlog для source yield та D1 soak. |
| P5. Контрольований release та фінальний синхронний перенос | OPS-03/04, MIG, DATA-09/15–17, BACKUP-01/02 | P1–P4 прийняті; production target перевірений окремо; користувач прямо підтвердив остаточний перенос. Одна узгоджена свіжа копія замість щоденного resync; production не очищується; усі відмінності пояснені; є rollback коду та перевірені копії | Заблоковано критеріями parity, не починати |
| P6. AI та додаткова генерація | Відкладені AI/генеративні PROFILE/AD, DATA-07, desktop/native push за потреби | AI/генерація мають окремо визначені джерела, приватність, витрати та людський контроль. WhatsApp Web operator automation більше не відкладається сюди: вона активна в P4. Viber real-chat autopost лишається поза активним scope до окремого прямого дозволу. Локальний AI — тільки за новим прямим дозволом. | Відкладено |

## P4-A — WhatsApp Discovery GO-LIVE — functional slice closed; performance tracked separately

**Closure note:** direct user decision on 2026-09-29 closes the functional P4-A slice on the physical evidence recorded above. Remaining source-yield/D1-soak items are P4-A-PERF and do not block the next functional roadmap slice.

- [x] Manual/recovery source preview лишається local-first: raw findings не пишуться в D1 до ручного confirm.
- [x] Targeted dedupe замість owner-wide candidate/chat scan.
- [x] Manual confirm → persisted candidate → canonical `to_join`.
- [x] Explicit «Запустити автопошук» запускає окремий goal-driven autonomous run: bounded source crawl → persisted work item → auto-handoff → messenger qualification без ручного confirm кожного invite.
- [x] Executor просуває source plan лише для active run, task-first і з bounded cadence; поза active run source crawl вимкнений.
- [x] WhatsApp Web CDP adapter має exact-target/fail-closed inspection, pending/joined facts, factual qualification і verified leave primitives.
- [x] **GO-LIVE-01:** staging exact HEAD green; authenticated WhatsApp Web runtime реально доступний executor-у.
- [x] **GO-LIVE-02:** один реальний local candidate проходить UI → confirm → exact WhatsApp target → join/request without manual API/SQL.\n  - 2026-09-25 live evidence: the autonomous UI-started run handed off a persisted WhatsApp invite to the paired executor; the invite factually joined `Technical Support` in authenticated WhatsApp Web without manual DB/SQL intervention. Earlier retry-later evidence remains valid as a separate fail-closed case.
- [x] **GO-LIVE-03:** factual pending автоматично recheck-иться; factual joined автоматично переходить у qualification. Не виробляти synthetic state, якщо pending природно не трапився.\n  - Live joined path accepted: executor observed the real joined state, persisted factual qualification and did not invent pending. The bounded pending recheck remains contract-covered; no natural pending case occurred in this run.
- [ ] **GO-LIVE-04:** real joined target стає usable ready chat; real rejected/unavailable joined chat проходить verified leave/archive.\n  - Rejected half physically accepted on staging: `Technical Support` was measured at 18 members with admin-only posting, classified rejected, then completed verified WhatsApp leave and canonical archive. Gate stays open until one real fully-qualified target reaches usable `ready`.
- [ ] **GO-LIVE-05:** restart/F5/reconnect не створює дубль, не губить local preview і не повторює вже підтверджену messenger action.
- [ ] **GO-LIVE-06:** провести реальний multi-candidate acceptance run без ручного DB/CLI між кандидатами; зібрати factual yield/errors і виправити blockers до operator-usable стану.
- [ ] **GO-LIVE-07:** перевірити D1 rows_read cold vs warm Platforms/Discovery; warm unchanged view не має коштувати тисячі reads.
- [ ] **GO-LIVE-08:** default goal 50 працює як outcome loop: продовжує source plan до 50 confirmed targets або чесно `sources_exhausted`; не знижувати qualification criteria заради цифри.
- [ ] **GO-LIVE-09:** у DEVELOPMENT_STATUS зафіксовані exact SHA, staging build, live messenger evidence, залишкові known limitations і чітке рішення «operator-usable: yes/no».

GO-LIVE-01…09 нижче лишаються історичним журналом pre-closure acceptance. Після рішення 2026-09-29 незакриті yield/soak пункти не блокують наступний functional slice: вони перенесені в P4-A-PERF. P4-A слід відкривати знову тільки при регресії join/qualification/dedupe/pause/recovery semantics або за прямим запитом на P4-A-PERF.

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
- User-facing release metadata зберігається в `lib/app-meta.ts`; кнопка версії в нижній частині навігації та діалог `Що змінилося` повинні оновлюватися разом із релізом. Поточний user-facing release: `v0.2.57`, дата 2026-09-24. Release metadata не підміняє окремі live messenger/two-device/native acceptance gates.
- Recorded performance matrix покриває 10k chats/profiles/library/leads + 100k events, query/rows/payload/EXPLAIN, staging API p95 і UI action latency; деталі — у `P4_PERFORMANCE.md`. Не повторювати повний performance прогін без зміни query shape/індексів або нового regression.
- Keyboard/a11y walkthrough не підтвердив потребу перетворювати Leads filters на tabs: це toggle-buttons у `fieldset` з `aria-pressed`, а не tablist. Deterministic focus-return тепер реалізований для history dialogs у Leads, lessons, Platforms, Library та Reports через exact trigger refs і regression contracts; physical keyboard/Safari acceptance лишається окремим live доказом.
- Archive/delete/leave parity закрито доменно: permanent delete є лише явно підтвердженим винятком для «Чат не існує», recheck-ить leave policy та відсутність publication/lead/pending-schedule dependencies, лишає audit snapshot і захищений state token/owner guards. CHAT-12/25 підвищені до «готово» після 359/359 local tests і production build; staging acceptance ще виконується canonical pipeline після push.
- Report history має optimistic revision guard для save/restore, bounded line-by-line comparison та завершений календарний heatmap 1/2/3/4+ з незалежними маркерами чернетки/зданого стану. `c46e5ee` пройшов canonical Cloudflare verify/deploy; тестові multi-version записи на staging навмисно не створювали лише заради smoke, бо pure/UI regressions перевіряють mapping без зміни живих даних.
- Реальні gaps не маскуються: offline/outbox, physical Safari/cross-device acceptance, final migration parity та реальний Chat Discovery runner/pairing, який виконає зовнішні дії й поверне результат у вже готовий executor contract. PAY-01..04, CRM message attachments і automatic real chat names уже реалізовані й не є відкритими gaps.

## Найближчий активний етап — FUNCTIONAL VALUE FIRST

1. Довести **goal-driven autonomous WhatsApp Discovery** до повного end-to-end. Оператор задає тільки кількість нових цільових чатів (default 50) і натискає «Запустити автопошук»; міста, keywords, часові періоди й query вручну не вводяться. Система сама проходить `lib/chat-discovery/seeds.ts`: public Telegram/t.me-derived search як primary source, public web як fallback.
2. `goal=50` означає **50 нових confirmed target chats саме цього run**, а не 50 URL/candidates/imports. Raw invite, pending, review, duplicate, archived/rejected/unavailable не зараховуються. Run продовжується до target goal або чесного `sources_exhausted`.
3. Новий WhatsApp invite після safe prefilter автоматично handoff-иться в canonical `to_join` і executor queue. WhatsApp executor вміє прив'язати фактичну назву до exact invite-code, зробити join/request/check і після joined збирає member count, recent/stale activity evidence, writeability/admin-only, explicit або evidence-based inferred ads policy та obvious spam/topic mismatch. Pending має bounded 3-хвилинний recheck; joined review — bounded 10-хвилинний reinspection. Залишок — live browser acceptance і розширення Telegram-source coverage, якщо public t.me-derived search не дає потрібної повноти.
4. **Rejoin suppression для Discovery**: будь-який уже відомий canonical chat/candidate, включно з archived/rejected/unavailable, не створюється як новий candidate і не потрапляє знову в `to_join`. Joined rejected/unavailable проходить exact-target verified external leave → archive; автоматично повернути його в pipeline можна лише після окремого явного manual restore/recheck.
5. **WhatsApp Web confirmed-send autopost**: text + batch queue source-complete у v0.2.57. Оператор може поставити один чат або до 30 ready WhatsApp chats у executor queue; Work OS резервує невикористані придатні Library materials між активними jobs, а кожен send лишається exact-target + confirmed-send і створює canonical publication fact лише після фактичної відправки. Залишок — live browser acceptance та canonical Library media/image attachment support.
6. **Publication consistency, Library і Viber safe mode** зараз є invariants/gates усередині нових slices, а не окремим багатотижневим пріоритетом. Не робити додатковий hardening/acceptance без конкретного functional blocker або нового regression.
7. Після завершення functional automation backlog провести пакетний **cross-device + physical iPhone/Safari + offline/reconnect + a11y acceptance**. Не розбивати це на нескінченну серію дрібних релізів, якщо функціональний workflow ще відсутній.
8. Не брати без окремого рішення: **Viber real-chat autopost**, offline outbox/PWA promises та final production cutover. Viber safe mode лишається тільки «Мої нотатки». Production — тільки після окремого прямого дозволу.

## Gate кожного коміту й push

- Достатньо конкретний обсяг, без змін Prototype Checker.
- Релевантні доменні/regression перевірки для ризикової логіки; проста текстова/візуальна зміна не потребує тесту, який лише дублює реалізацію.
- `npm run verify` у Cloudflare Workers Builds = production build gate. Повний `npm run verify:local` = lint → typecheck → full tests → production build і виконується окремо лише там, де доступний придатний runner; його відсутність не маскується як green.
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
- v0.2.38 completes the current Library advertisement data/UX slice: supported platforms are canonical and server-validated, platform/direction selection is structured, legacy/custom tags are preserved, generic all-platform ads remain visible in filtered views, UA/RU editing is responsive, and same-day advertisement usage is visible by platform. Native Viber safe-mode implementation is next; physical native acceptance remains separate because Desktop Commander is reserved for website automation.


## v0.2.39 — Viber safe-mode operator slice

- [x] Library can enqueue a Viber safe-note job from an eligible active advertisement and selected UA/RU material.
- [x] Active job state reconciles from the server and can be cancelled from Library.
- [x] UI and server contract state that the target is only «Мої нотатки» and the smoke test creates no publication accounting fact.
- [ ] Native CachyOS/Viber send acceptance remains a separate manual/future gate; real Viber chats stay disabled until explicit approval.
- Next: continue Chat Discovery/external executor acceptance and website-based WhatsApp automation without weakening fail-closed target verification.


## v0.2.40 — executor target-verification hardening

- [x] Discovery executor tasks expose the expected target, runtime (whatsapp_web / viber_native) and a fail-closed target-verification requirement.
- [x] External executor membership/inspection callbacks that assert accessible/pending/joined/inspected state require targetVerified=true; manual operator qualification remains a separate trusted UI path.
- [x] External leave requires the same target proof before any archive/leave mutation.
- [x] The reference runner short-circuits unknown/wrong targets, and the pairing panel documents WhatsApp Web vs Viber native behavior.
- [x] Reference runner now has an optional CDP-backed WhatsApp Web adapter: it opens the exact web invite inside an already-authorized browser profile, verifies the rendered target name before any join/request click, distinguishes joined/pending/known-invalid states, derives writeability only from the actual composer/admin-only UI, and leaves topic/ads/activity unknown rather than inventing qualification facts. Generated placeholder names cannot pass target verification; known-invalid copy is accepted only while the current URL still carries the exact expected invite code, so stale/global DOM cannot reject another candidate. CDP control is restricted to unauthenticated loopback HTTP/WebSocket endpoints so executor task data is never sent to a remote debugger.
- [ ] Real WhatsApp Web automation acceptance remains open: the current Opera session has no Browser Connector/CDP endpoint exposed, so no live callback was claimed. Manual runner fallback remains available and ambiguous CDP state sends no executor callback.


## v0.2.41 — Platforms operator UX cleanup

- [x] Replace the oversized Platforms hero with a compact operator header while preserving platform switching and discovery/add actions.
- [x] Merge pace, daily goal, available, joined and published facts into one compact overview instead of separate stacked surfaces.
- [x] Move quick-publish context inside the ready queue and remove duplicated queue-count chrome.
- [x] Rename the row action from «Опублікувати» to «Підготувати» because it opens the preparation dialog; only the final confirmation records publication.
- [x] Remove obsolete today-links, posting-pace, quick-publish-bar and platform-hero styling paths; extract the daily overview from the already-large workspace component.
- [x] Preserve container-responsive chat rows, silent server reconciliation and 44px mobile action targets.
- [ ] Canonical Workers build/staging /api/build and live desktop/narrow/mobile visual acceptance remain the release evidence gate.


## v0.2.42 — Platforms queue transition cleanup

- [x] Keep a per-view in-memory queue cache keyed by platform/queue/search/profile/page/account.
- [x] Superseded by v0.2.59 quota hardening: exact-view cache remains, but automatic sibling queue prefetch is removed; D1-backed queues load on demand instead of speculatively.
- [x] Treat cached views as UX cache only: successful mutations, imports/profile changes and server revision sync invalidate affected cache before canonical reconciliation.
- [x] Keep the full loader only for a genuinely uncached first request or new search/filter/page.
- [x] Add source regression coverage for exact-view cache, on-demand loading and invalidation behavior.
- Build discipline: prefer one coherent commit per completed slice so Cloudflare Workers Builds does not queue and skip a chain of intermediate commits.
- [ ] Staging /api/build and live transition acceptance remain the release evidence gate.


## v0.2.43 — Unified loading and transition architecture

- [x] Keep visited main workspaces mounted instead of remounting them on every navigation change.
- [x] Introduce shared initial, inline and delayed background-refresh loading states and remove the legacy blocking workspace loader from product components.
- [x] Preserve exact-view data while revalidating Platforms, CRM, Analytics, Reports and Library; Library and Reports explicitly guard view identity so stale data cannot appear under a different collection/date/month.
- [x] Cache high-frequency nested surfaces including chat/report/lead history, analytics metric details, publication preparation, duplicate management, Telegram warmup/schedule and report correction helpers.
- [x] Remove remount-key refresh patterns from chat profile, chat history, publication preparation and CRM conversation state.
- [x] Returning to Today requests a lightweight authoritative revision check instead of forcing an unconditional RSC refresh.
- [x] Persistent hidden workspaces close overlays and suppress hidden shortcuts/portal children.
- [x] Add repo-wide regression coverage that forbids the old blocking loader and remount-based refresh pattern.
- [ ] Full verify evidence and live staging desktop/narrow/mobile transition acceptance remain the release gate.
- Next after the release gate: continue the highest-priority unfinished ROADMAP slice, currently Chat Discovery external executor / WhatsApp Web acceptance unless main documentation changes first.


## v0.2.44 — Profile clarification queue

- [x] Add a dedicated «Уточнити профіль» Platforms queue instead of relying only on the waiting/ready profile filter.
- [x] Server-side virtual queue combines only `waiting` + `ready` chats whose profile is draft or missing; D1 remains source of truth and the returned row keeps its canonical workflow status.
- [x] The queue shows whether each chat is still «Очікування» or already «Для публікації» and makes profile editing the primary action. Confirmed profiles disappear after canonical reconciliation without changing publication history.
- [x] Queue counters include the combined draft/missing total; existing per-workflow profile counts and quick-publish behavior remain unchanged.
- [x] Desktop/tiled layout supports five queue tabs without overlap; mobile keeps the existing horizontal 48px tab strip. Regression coverage protects server filtering, operator actions and responsive layout.
- [ ] Full `verify:local` and live desktop/narrow/mobile/Safari acceptance remain release evidence gates. Canonical Workers staging build and `/api/build` identity are checked separately after the release commit.
- Next: resume real WhatsApp Web executor acceptance when an authorized browser automation endpoint is available; otherwise continue the next non-physical P4 parity gap without weakening live acceptance requirements.


## v0.2.45 — Analytics exact-range decision overview

- [x] Bind the decision-first overview to the exact day/week/month/year/custom Analytics query instead of always showing the current month.
- [x] Use the monthly goal effective on the selected range end date and count month-to-date fact only through that date.
- [x] Compare bookings against the immediately preceding equal-length period and build the chat recommendation from the same selected range.
- [x] Add exact-query caches to Analytics and its overview so period changes show only that view's cache or a stable initial loading state; stale data from another period is never rendered under the new filter.
- [x] Keep the first level bounded to seven signals (three compact decision signals + four canonical activity metrics) and one explainable recommendation; archive details stay behind disclosure.
- [x] Add regression coverage for range propagation, historical month-to-date isolation and exact-view cache identity.
- [ ] Full `verify:local` and live desktop/narrow/mobile/Safari acceptance remain release evidence gates. Canonical Workers staging build and `/api/build` identity are checked after the release commit.
- Next: resume real WhatsApp Web executor acceptance when browser control is available; otherwise continue the next evidence-backed non-physical P4 parity/reliability gap from current main.

## v0.2.46 — Confirmed-profile normal publication gate

- [x] Normal publication requires a confirmed chat profile server-side; a direct request cannot bypass the UI.
- [x] The atomic publication INSERT rechecks the confirmed profile so a concurrent profile change cannot create a publication fact from stale eligibility.
- [x] WhatsApp/Viber quick mode remains the explicit urgent-manual exception, still requires a concrete material and never confirms the profile automatically.
- [x] The ready-list primary action opens profile editing for draft/missing profiles outside quick mode; quick mode keeps «Підготувати».
- [x] «Доступні для публікації зараз» now contains only confirmed profiles that also satisfy cadence/day/next-date rules; legacy confirmed rows with nullable cadence/weekdays stay eligible via canonical defaults.
- [x] Regression fixtures now make confirmed-profile assumptions explicit and protect ordinary-vs-quick behavior, publication consistency and Undo.
- [ ] Full `verify:local` and live desktop/narrow/mobile/Safari acceptance remain release evidence gates. Canonical Workers staging build and `/api/build` identity are checked separately after the release commit.
- Next: resume real WhatsApp Web executor acceptance when browser control is available; otherwise continue the next evidence-backed non-physical P4 parity/reliability gap from current main.

## v0.2.47 — Bilingual advertisement save invariant

- [x] New and edited advertisements require both UA and RU body text server-side.
- [x] Library save controls mirror the server rule and label both advertisement language fields as required.
- [x] Existing one-language legacy advertisements are preserved without destructive migration and are visibly marked with the missing language before the next save.
- [x] Scripts and knowledge materials keep the previous one-language-allowed behavior.
- [x] Regression contract protects API validation, UI disablement and the non-destructive legacy repair message.
- [ ] Historical legacy advertisements still need explicit operator cleanup before AD-02 can be promoted from partial; no automatic text generation or silent rewrite is performed.
- [ ] Full `verify:local` and live desktop/narrow/mobile/Safari acceptance remain release evidence gates. Canonical Workers staging build and `/api/build` identity are checked separately after the release commit.
- Next: resume real WhatsApp Web executor acceptance when browser control is available; otherwise continue the next evidence-backed non-physical P4 parity/reliability gap from current main.


## v0.2.59 — D1 budget hardening + joined-today parity

- [x] Global D1-backed revision sync uses adaptive 10s active → 30s → 60s unchanged backoff and up to 5m error backoff; focus/online/local-write remain immediate event-driven wakeups.
- [x] Platforms no longer prefetches sibling queues without user intent; exact-view cache remains.
- [x] D1 budget regression contract protects sync backoff, no speculative queue prefetch, Discovery runner backoff/heartbeat/task limits and code-only deploy migration-read skipping.
- [x] WhatsApp and Viber both expose the expandable «Приєднані сьогодні» block.
- [x] Canonical autonomous-development prompt moved into the repository with mandatory D1 budget rules.
- [ ] Canonical Workers staging build must reach this exact HEAD; data-backed live acceptance waits for the current D1 daily quota reset instead of retrying the exhausted database.


## v0.2.60 — D1 quota recovery UX

- [x] Root server render detects the known Cloudflare D1 daily row-read limit failure and shows a dedicated Work OS recovery screen.
- [x] The recovery path performs no additional D1 reads and does not expose a retry loop.
- [x] Non-quota exceptions remain real errors and are not hidden by the recovery screen.
- [x] Regression coverage protects direct/nested quota error recognition and the no-retry recovery path.
- [ ] Live authenticated acceptance waits for the daily D1 reset; do not probe the exhausted database to prove the fallback.

## v0.2.61 — remaining recurring D1 pollers

- [x] Workday keeps a local 1s display clock but replaces fixed 5s D1 polling with adaptive 5s active → 15s → 30s → 60s unchanged backoff and up to 5m error backoff.
- [x] Workday polling is visibility/online gated; focus/online/BroadcastChannel remain immediate wake signals.
- [x] Viber safe-mode replaces fixed 2s broad messenger polling with a targeted owner-scoped job read and 5s → 10s → 20s → 40s → 60s backoff.
- [x] D1 budget contracts protect both paths from returning to fixed high-frequency request intervals.
- [ ] Live data-backed acceptance waits for the current D1 daily quota reset; deploy identity may be checked only through non-D1 `/api/build`.
- Next functional slice after the quota incident: resume WhatsApp Web executor/live acceptance when D1 and local browser control are available; otherwise continue canonical Library image/media support without weakening quota rules.


## v0.2.62 — Telegram-derived Discovery coverage

- [x] Keep the deterministic workbook seed cursor but add one bounded broader Telegram search variant only when the strict `chat.whatsapp.com` query does not expose enough sources.
- [x] Convert public Telegram channel/message results to `t.me/s` history previews before extraction so older public posts can contribute WhatsApp invites.
- [x] Reject private invite/internal/service Telegram URLs from the crawler; preserve safe-public URL and bounded fetch limits.
- [x] Preserve exact Telegram preview provenance on extracted candidates.
- [ ] Live yield comparison waits for D1 quota reset; do not start an autonomous run against the exhausted staging DB only to measure coverage.
- Next: after D1 reset + browser control, run real WhatsApp Discovery/executor acceptance; otherwise continue code-only canonical Library image/media design without pushing a migration until staging D1 can preflight it.


## v0.2.63 — Telegram city aliases

- [x] Preserve Latin/native city names from the seed workbook in each deterministic Telegram search task.
- [x] Search canonical and Latin city spellings before the broader WhatsApp fallback, with early exit once enough public Telegram sources are found.
- [x] Keep the same seed cursor/task count and D1 persistence semantics; only public-source discovery coverage changes.
- [x] Bound search fan-out to at most three variants per seed task and the existing Telegram pageLimit.
- [ ] Live yield/target-rate comparison waits for staging D1 quota reset.


## v0.2.64 — bounded Telegram history follow-up

- [x] Follow one same-channel numeric `?before=` history page only when the current public Telegram preview yields no invite.
- [x] Never recurse history pagination; cap the additional crawl at +1 fetch per seed task.
- [x] Skip history pagination when the current preview already yields an invite.
- [x] Reject foreign-channel/newer/private/internal pagination targets and preserve exact older-preview provenance.
- [ ] Live yield comparison remains blocked by the exhausted staging D1 quota; do not start a run solely to measure this before reset.


## v0.2.65 — Telegram source diversity

- [x] Deduplicate Telegram search results by case-insensitive public channel username before applying pageLimit.
- [x] Treat t.me / telegram.me posts from the same channel as one source-budget slot while preserving the first exact URL as provenance.
- [x] Keep same-channel bounded history follow-up compatible with canonical channel identity.
- [x] Regression coverage proves duplicate posts cannot consume multiple Telegram preview slots.
- [ ] Live source-diversity/yield comparison waits for staging D1 quota reset.


## v0.2.66 — active Discovery source budget

- [x] Separate 3s messenger-task handoff from source crawling; an empty source advance waits 60s.
- [x] Keep 3s follow-up only after real messenger work or when source discovery actually added a candidate.
- [x] Pause autonomous source discovery in non-interactive runner when WhatsApp CDP is not configured, so impossible join/inspect work cannot accumulate.
- [x] Reduce one Telegram source advance to 1 seed query / 2 public previews and public-web fallback to 2 queries.
- [x] D1 budget contract protects active-source cadence and batch fan-out, not only idle polling.
- [ ] Live 8h rows_read/search-rate measurement waits for staging D1 quota reset.


## v0.2.67 — WhatsApp runtime readiness gate

- [x] Non-interactive runner without WhatsApp CDP exits before any executor/API polling.
- [x] WhatsApp auth/page/CDP transient failures pause new Discovery source crawl for 5 minutes instead of accumulating unprocessable candidates.
- [x] Verified successful WhatsApp runtime work clears the cooldown immediately; interactive manual fallback stays available.
- [x] Canonical autonomous prompt locks the active-source cadence/runtime readiness rule.
- [x] D1 regression contract protects startup fail-closed and runtime cooldown.
- [ ] Physical WhatsApp Web acceptance remains blocked until a real CDP-enabled authenticated session is available.


## v0.2.68 — factual WhatsApp topic qualification

- [x] Derive positive WhatsApp topic match from observed Ukrainian group identity, not from the search query/source text.
- [x] Keep generic/non-Ukrainian identity as unknown instead of guessing.
- [x] Preserve spam/topic mismatch precedence over Ukrainian identity.
- [x] Regression coverage protects positive, unknown and mismatch runtime cases.
- [ ] Physical WhatsApp Web acceptance remains pending until a CDP-enabled authenticated session is available.


## v0.2.69 — factual compact WhatsApp member counts

- [x] Parse K/тис./тыс. compact member counts from observed WhatsApp group info.
- [x] Preserve full localized integer counts and the canonical 700–18,000 target threshold.
- [x] Require a member/participant label so unrelated compact numbers remain unknown.
- [x] Regression coverage protects English/Ukrainian/Russian compact formats and non-member numbers.
- [ ] Physical WhatsApp Web acceptance remains pending until a CDP-enabled authenticated session is available.


## v0.2.70 — broader factual WhatsApp ad evidence

- [x] Expand ad-like evidence to common UA/RU/EN marketplace, wanted, service, work, rent and transport wording.
- [x] Preserve the threshold of recent activity + at least two visible ad-like messages.
- [x] Preserve explicit prohibition precedence and fail closed for one-message/inactive evidence.
- [x] Regression coverage protects positive and negative inference cases.
- [ ] Physical WhatsApp Web acceptance remains pending until a CDP-enabled authenticated session is available.


## v0.2.71 — WhatsApp activity timestamp correctness

- [x] Parse year-first visible WhatsApp message dates before ambiguous day/month formats.
- [x] Reject partial-year matches and impossible calendar dates.
- [x] Preserve the existing ≤72h active / ≥14d dead / middle unknown thresholds.
- [x] Regression coverage protects ISO recent/stale and invalid-date unknown cases.
- [ ] Physical WhatsApp Web acceptance remains pending until a CDP-enabled authenticated session is available.


## v0.2.72 — locale-aware WhatsApp activity dates

- [x] Capture browser locale in the WhatsApp Web factual snapshot.
- [x] Resolve ambiguous numeric message dates using the locale's actual day/month ordering.
- [x] Keep unambiguous and ISO dates locale-independent.
- [x] Treat ambiguous dates with missing/invalid locale as unknown instead of guessing.
- [x] Regression coverage proves en-US vs uk-UA divergence and no-locale fail-closed behavior.
- [ ] Physical WhatsApp Web acceptance remains pending until a CDP-enabled authenticated session is available.


## v0.2.73 — local WhatsApp factual preflight

- [x] Autosearch no longer treats the first N invite URLs as N targets; goal counts only browser-verified target chats.
- [x] Exact invite URLs are deduped before WhatsApp work; post-join duplicate identity is also suppressed so refreshed invite codes cannot inflate the goal.
- [x] Browser-local executor opens candidates in WhatsApp Web, auto-joins only direct-join chats, inspects factual criteria, and leaves rejected joined chats with exact-target verification.
- [x] Factual request/admin-approval invites are skipped without clicking the request control and do not enter the goal.
- [x] D1 persistence remains after factual qualification and explicit operator confirmation; intermediate search/preflight remains local.
- [ ] Live acceptance after reboot: CDP-enabled Opera runtime + local executor must be active, then prove 10-target and 30-target runs against real WhatsApp Web.

## 2026-09-25 — D1 read-budget + local-first Discovery

- [x] Replace Platforms owner-wide queue counts with maintained `chat_queue_counts` read-model and index-friendly 50-row paging.
- [x] Add revision-aware Worker cache to Platforms, Analytics/overview, Library, Reports and Leads list reads. Repeated unchanged views hit Worker cache; writes change the authoritative revision and naturally invalidate the cache key.
- [x] Keep short time buckets on time-sensitive views so snooze/deadline/final-report state cannot remain stale behind a stable revision.
- [x] Replace Discovery's up-to-10k owner-wide duplicate scan with targeted `normalized_link IN (...)` lookups for the current preview batch.
- [x] Move Telegram/public source crawl out of executor persistence and into browser-local preview.
- [x] Persist raw Discovery candidates nowhere in D1 before explicit operator confirmation.
- [x] Keep local candidates through F5 in `sessionStorage`; raw invite/search/preflight state stays local and only factual targets may cross the D1 persistence boundary after explicit operator confirmation.
- [x] Executor never advances source discovery through D1. The local WhatsApp bridge may preflight browser-local candidates before persistence: exact invite → direct join → factual qualification → verified leave when rejected.
- [x] Regression contracts guard cache coverage, targeted dedupe and the local-first persistence boundary.
- [ ] Physical end-to-end WhatsApp Web acceptance with a real authenticated CDP session: local discovery → exact-link dedupe → direct join (approval-required skipped) → factual qualification → target/reject → verified cleanup → final operator confirm → D1 persistence.
- [ ] Measure real staging rows_read after quota reset for cold Platforms, warm Platforms, Analytics and Discovery preview; treat any ordinary unchanged warm view that still consumes thousands of rows as a regression.
- [ ] Tune source yield/false-positive rate against real WhatsApp groups; do not weaken fail-closed qualification to reach the target count.


- [x] **FAST-SOURCE-01:** source discovery moved to browser-local burst mode: up to 6 external queries per batch, zero intermediate D1 writes, only targeted duplicate reads for exact found links.
- [ ] **FAST-SOURCE-02:** live staging acceptance: confirm the local run visibly advances found/WhatsApp-checked/rejected/duplicate/target counters, reaches 10 then 30 factual targets in practical time, skips approval-required chats, and only the explicit final «Додати N цільових у Work OS» action creates Discovery rows in D1.


## 2026-09-28 — GO-LIVE-04/06/08 source and outcome correction

- Implemented full compatible workbook-derived source coverage, bounded Telegram history, explicit retry/pause on source failure, and local outcome lists with factual reasons.
- Fixed source-batch truncation, misleading inspected counts and mandatory dependency on WhatsApp's internal invite query.
- Eight focused behavioral checks passed in memory; source/TSX syntax checks passed. Full verify:local and physical acceptance are not asserted.
- Gates remain open: exact deployed build + refreshed local runner + one real target reaching the final ready workflow must still be observed. A code commit does not close these gates.
