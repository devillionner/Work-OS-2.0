# Work OS 2.0 — поетапний roadmap

Оновлено: 2026-09-15. Обсяг і статус кожної вимоги — у [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md). Етап завершується за доказами приймання, а не за наявністю екрана. Працюємо в main невеликими комітами; кожен push проходить локальні lint/tests/build. AI й автопостинг не випереджають ручну роботу.

| Етап | Обсяг | Критерії готовності | Стан |
| --- | --- | --- | --- |
| P0. Реєстр і безпечна розробка | Канонічні вимоги, актуальна архітектура, правила D1, локальний verify/CI, обмеження polling, відмова від регулярного resync | Усі 253 legacy ID присутні; кожен пункт має один із чотирьох статусів; суперечності пояснені; локальні тести проходять; CI не містить deploy/Cloudflare secrets; GET таймерів не змінює D1; прострочення/помилка мережі не створює запит щосекунди | Готово локально; Linux CI для 152173a пройшов |
| P1. Щоденний ручний постинг | CORE/CHAT/IMPORT/TIMER/PUB/PROFILE, ручна частина AD, SCHED-01, UX-02 | Повний шлях додати → приєднати/очікувати → профіль → відкрити чат/скопіювати оголошення → вручну опублікувати → одна подія → архів/відновлення. Telegram-акаунти, черги й розклад ізольовані. Усі обмеження перевіряються сервером. Повернення з месенджера зберігає контекст. Є loading/empty/error/retry/undo там, де безпечно | Functional pre-UX завершено; далі UX/visual QA |
| P2. CRM та єдина черга «Сьогодні» | LEAD, CRM-01–04, CAL-02/04, CORE-01/09, SCRIPT/KNOW | Швидке створення неповного ліда; контакт може не навчатися; кілька учнів/уроків; ручний запит куратору; скасування відгуку; джерело/бізнес-дати; Today показує справжні прострочені follow-up та нагадування з переходом до конкретного ліда. Повторна доставка/подвійний клік не створює зайвої події. Бібліотека й скрипти придатні для щоденного використання | Core CRM functional pre-UX завершено; KNOW/media/scripts-context лишаються окремим scope |
| P3. Звіти, цілі та детальна аналітика | REPORT, ANALYTICS, CAL-01/03, UX-01/03/04, DATA-10/14 | Today, платформи, звіт і аналітика показують однаковий подієвий факт. Ручна корекція видима окремо. Календар/версії/здача/застарілість/історичний контекст працюють. Денні/місячні цілі мають історію. Є довільні періоди, предмети, джерельні події, унікальні ліди та всі записи окремо, когортний і подієвий погляди, атрибуція оголошення/чату, експорт | Functional pre-UX завершено для core reports/analytics; REPORT-22/subject IA лишаються UX/next-scope |
| P4. Надійність, UX/visual quality та functional parity | Решта CORE/QA/DATA, OPS-05–07, BACKUP, PAY, PWA/offline | Усі потрібні ручні сценарії реєстру прийняті; таблиця відповідності робочій логіці актуального Prototype; 10k чатів/10k лідів/100k подій локально; p95 API <500 мс і UI <1 с на записаному стенді; query counts/rows/payload виміряні; desktop/mobile/iPhone, keyboard/a11y та visual QA; конфлікти/втрата мережі/повторне відкриття/restore перевірені. Платіжні правила введені користувачем; offline і PWA не імітують непідтверджений запис | **Активний етап.** Authenticated staging desktop/tiled/mobile Chromium visual QA, design-polish і recorded performance matrix виконані; далі physical iPhone/Safari та remaining reliability/a11y P4 gates |
| P5. Контрольований release та фінальний синхронний перенос | OPS-03/04, MIG, DATA-09/15–17, BACKUP-01/02 | P1–P4 прийняті; наведені нижче gates пройдені; користувач прямо підтвердив остаточний перенос. Одна узгоджена свіжа копія замість щоденного resync; production не очищується; усі відмінності пояснені; є rollback коду та перевірені копії | Заблоковано критеріями parity, не починати |
| P6. AI та додаткова автоматизація | Відкладені PROFILE/AD, LATER, DATA-07, desktop/native push за потреби | Надійний ручний процес прийнято; окремо визначено джерела, приватність, витрати, перегляд і підтвердження. Генерація/автопостинг не змінюють факт публікації до підтвердженого результату. Локальний AI — тільки за новим прямим дозволом | Відкладено |

## Поточний стан P4 — 2026-09-15

- UX/visual hardening PR #87–#103 merged у `main`; актуальний `main` — `4b0d923`. Останній runtime full local gate перед #103: lint 0/0, **261/261 tests**, production build green.
- Staging передеплоєно перевіреним build на `work-os-2-staging`; поточна перевірена версія Worker — `ee997a7a-4e59-4ee9-9919-9d377dd2e56f`. Worker і D1 target перед deploy перевірені; production не змінювався.
- Authenticated Chromium visual QA виконано на wide/laptop/tiled/mobile widths. Підтверджено виправлення primary foreground/dialog surfaces, Platforms overlap, Today workday/empty-state density, Telegram disclosure density, Analytics trend/funnel layout, stale booked-lesson next action, Reports event-list/calendar stretch і Settings tiled actions. На 440 px усі сім основних розділів мають document width 440/440; горизонтальний overflow лишився тільки всередині навмисно scrollable tables/tab rows.
- Recorded performance matrix тепер покриває 10k chats/profiles/library/leads + 100k events, query/rows/payload/EXPLAIN, staging API p95 і UI action latency; деталі — у `P4_PERFORMANCE.md`. Реальний iPhone/Safari acceptance лишається окремим P4 gate. Наступна послідовність: physical iPhone/Safari check → remaining accessibility/restore/network/reopen evidence → requirements status sync.
- Реальні відкладені gaps не маскуються: automatic real chat names, CRM media, structured report manual-diff, PAY/knowledge/offline, final migration parity.

Фази допускають невеликі незалежні виправлення з пізніших етапів, якщо вони прибирають поточний дефект; це не означає проходження всього етапу. Exact restore BACKUP-03 лишається окремим відкладеним рішенням. Вимоги остаточного видалення не дозволяють видаляти production-дані під час розробки. PAY/PWA/offline не губляться: якщо буде прийнято рішення перенести їх за parity, це фіксується в реєстрі прямим рішенням користувача.

## Найближчий активний етап

1. Провести окремий **physical iPhone/Safari** acceptance: safe areas, touch, keyboard, deep links і responsive composition. Chromium viewport QA не зараховувати як доказ Safari.
2. Закрити remaining accessibility та reliability evidence: keyboard/focus gaps, network loss, stale/retry, reopen/reload і restore scenarios.
3. Синхронізувати статуси PRODUCT_REQUIREMENTS лише з фактичними доказами та сформувати остаточний parity gap list перед P5.
4. Performance matrix не повторювати без зміни query shape/індексів або нового performance regression; поточний доказ зберігається в `P4_PERFORMANCE.md`.
5. Не брати без окремого рішення: automatic real chat-name fetching, CRM media storage, PAY, offline/PWA, AI/autoposting та final production cutover. Перед production release — explicit target/dry-run, migration/backup gates і прямий дозвіл користувача.

## Gate кожного коміту й push

- Достатньо конкретний обсяг для перегляду, без змін Prototype Checker.
- Релевантні доменні перевірки для ризикової логіки; проста текстова/візуальна зміна не потребує тесту, який лише дублює реалізацію.
- `npm run verify`: lint → tests → build локально. Після успіху — commit/push. Не повторювати весь набір без зміни коду, нового збою або нового ризику.
- CI запускає той самий локальний набір. Провал виправляється в main. Жодних remote migrations, resync, restore-drill або deploy від push.
- Статус у реєстрі змінюється тільки з доказами; невиконана visual QA лишається явно непідтвердженою.

## Gate контрольованого release

1. Зафіксувати commit, результати локальних перевірок, середовище Worker і D1, список необхідних SQL-міграцій. Не запускати міграції автоматично разом із deploy.
2. Перевірити зовнішній Workers Builds/Git integration. Read-only огляд 2026-09-10 повернув порожні списки triggers для work-os-2 і work-os-2-staging. У репозиторії CI лише перевіряє; повторний огляд потрібен, якщо конфігурація release зміниться.
3. Вибрати environment **до build** через `CLOUDFLARE_ENV`. Перевірити згенерований `dist/server/wrangler.json` перед окремим deploy. Передавати `--env production` лише наприкінці старої build-команди недостатньо.
4. Локально пройти релевантні UI-сценарії. Windows/Linux — desktop browser; iPhone — вузький viewport і окрема Safari-перевірка touch/клавіатури/deep links/звуку. Емуляція ширини не доводить сумісність iPhone.
5. Remote deploy є контрольованою публікацією; production-міграція/дані — окремою операцією з прямим дозволом. Після release — короткий read-only health/smoke check, не повний тестовий цикл проти D1.
6. При проблемі повернути попередню версію Worker. Не запускати автоматичний downgrade/очищення D1; сумісність схеми перевіряється до релізу.

## Gate фінального переносу

- Функціональна відповідність перевірена за актуальним read-only Prototype та цим реєстром; нові вимоги додаються з ID, дані щоденно не синхронізуються.
- Пряме підтвердження користувача стосується конкретного snapshot, цілі та погодженого вікна переносу.
- Зберегти свіжий повний вихідний backup і поточний Work OS backup, hash/version/counts. Відомі totals зі старого CUTOVER не використовувати як сьогоднішні.
- Локально виконати dry-run/mapper/restore і порівняти counts, IDs, усі поля, зв’язки, події, unknown/raw keys, account ownership, цілі та звіти. Відсутність запису у джерелі не означає видалення в цілі.
- Розглянути всі managed/conflicting records; не обходити guard і не перезапускати імпорт навмання. Визначити очікувані existing/missing/conflict результати кожної порції.
- Провести один погоджений перенос з resumable progress і обмеженою перевіркою. Повтор — лише для конкретного невдалого кроку з поясненням, не як перевірка стабільності.
- Порівняти фінальні дані/події, зробити дві успішні перевірені копії нової бази за період реальної роботи. Prototype зберігається; його видалення/виведення з експлуатації потребує окремого рішення.


## UX phase update — 2026-09-15
Current phase: UI/UX. Bulk >500 queued batching, real-name enrichment and archive deletion policy are recorded requirements, not reasons to delay UX foundation. Today reminders must be separated into Tomorrow/Today intent groups; navigation has one Settings entry.

- UX foundation: one Settings entry, calendar-day reminder groups, explicit calendar labels, subject analytics moved to Analytics, report event details collapsed, manager schedule quick-link, chat history demoted to secondary action, and mobile bottom navigation includes a More entry.

- Leads/mobile CRM UX: mobile uses a focused list → detail flow with an explicit back action; secondary history/refresh controls are de-emphasized while core lead actions remain visible.

- Today/mobile hierarchy: bottom navigation now has an explicit More entry for Reports, Library and Settings; decorative cloud-profile status card removed from the daily dashboard.

- Visual hierarchy pass: Today prioritizes the action queue; workday and goals form a compact control column; platform results are a full-width summary. Workday styling is isolated from decorative status UI.

- Navigation accessibility pass: mobile drawer closes with Escape, menu/close controls use 44px touch targets, and sidebar/bottom-nav focus states are visible.

- Final responsive polish: mobile bottom navigation respects iOS safe areas and reduced-motion preferences disable nonessential motion.

- Modal/accessibility hardening: Today goals, chat CSV, legacy import and backup restore use the shared focus-trapped Dialog semantics; Escape/backdrop behavior and mobile touch targets are being standardized before authenticated visual QA.

- 2026-09-15 hardening: mobile shell uses iPhone safe areas; operator copy avoids implementation jargon; dynamic errors use alert semantics; Library and Platform tablists use roving tab stops with ArrowLeft/ArrowRight/Home/End navigation. Authenticated Chromium screenshot/DOM QA is now complete through PR #103 and staging `ee997a7a`; physical iPhone/Safari plus remaining P4 reliability/performance evidence are still required before P4 is accepted.
