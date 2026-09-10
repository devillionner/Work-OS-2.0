# Архітектура Work OS 2.0

Актуальний продуктовий контракт: [PRODUCT_REQUIREMENTS](PRODUCT_REQUIREMENTS.md).
Статуси та обмеження опису архітектури не замінюють цей реєстр. Dashboard, summary
звіту та подієва частина аналітики використовують спільний запит activity_events;
report_text не впливає на лічильники. Відкриття джерел чисел і простежувані ручні
корекції DATA-10/REPORT-22 ще потребують реалізації.
[ROADMAP](ROADMAP.md) визначає local-only перевірки та release gates.

Ручні дії чатів передають stateToken з прочитаного списку. Він містить робочий
стан і останні ID переходу/публікації; перевіряється повторно всередині D1 batch.
Однакові timestamps не дозволяють застарілій дії пройти після архіву/відновлення.
Подія chat_state_changed записується лише після успішного guarded UPDATE; метрика
chat_joined і Telegram join_streak залежать від нової події. Історія й бізнес-факт
зберігаються при архівації; GET стану використовує наявні індекси й не пише D1.
Схема БД для цього не змінюється. Видимий журнал історії ще не реалізований.

## Мета

Один приватний браузерний застосунок, доступний з Windows, Linux та телефона без постійно ввімкненого домашнього ноутбука.

## Технологічна основа

- React + TypeScript і серверний рендеринг через vinext;
- власний Cloudflare Worker на безкоштовній адресі `workers.dev`;
- Google Identity Services із точним списком дозволених Gmail-акаунтів;
- D1 як постійна хмарна база даних;
- адаптивна дизайн-система з єдиними компонентами.

## Модулі

- **Сьогодні** — фокус, цілі, черга роботи, нагадування;
- **Платформи** — чати, приєднання, очікування, публікації та архів;
- **Ліди** — контакти, учні, записи, уроки й нагадування;
- **Аналітика** — конверсії платформ, чатів, оголошень і напрямків;
- **Звіти** — історія, коригування й календар активності;
- **Бібліотека** — оголошення, переклади та робочі скрипти;
- **Налаштування** — цілі, фокус напрямків, платформи, резервні копії.

## Дані

Статистика не зберігається окремими ручними лічильниками. Вона розраховується з незмінної історії подій, щоб цифри в чаті, платформі, оголошенні та звіті не суперечили одна одній.

Основні сутності зберігаються окремо: `telegram_accounts`, `work_timers`, `chats`, `chat_profiles`, `chat_publications`, `leads`, `students`, `lessons`, `daily_reports`, `user_settings`. Таймери зберігають абсолютний час завершення в D1, тому не залежать від відкритого розділу чи конкретного пристрою. Таблиця `activity_events` є єдиним джерелом для майбутньої аналітики конверсій. Вихідна резервна копія зберігається окремо й дозволяє провести повторну звірку без втрати інформації.

### Telegram-акаунти

Telegram-акаунт має постійний внутрішній ID та окремі черги, лічильник приєднань і перерву. Необроблені чати залишаються спільним пулом і закріплюються за активним акаунтом під час приєднання або переходу в очікування. Публікація та подія аналітики зберігають ID акаунта. Для нового Telegram-чату сервер суворо блокує публікацію протягом шести годин після приєднання.

### Дати у воронці

Дата відгуку (`leads.response_date`), дата запису (`leads.booking_date` і `lessons.booking_date`) та дата уроку (`lessons.lesson_date`) — незалежні бізнес-події. Поля `created_at`, `booked_at` і `updated_at` зберігають технічний час дії та не визначають, у звіт якого дня потрапляє відгук або запис. `activity_events.event_date` завжди відповідає бізнес-даті події.

Запит куратору є окремою сутністю `curator_requests`. Активний запит тимчасово дає одну подію `curator_booking_pending`; після підтвердження її має замінити фактичний `lesson_booked`, а після скасування вона перестає враховуватися. Це унеможливлює подвійний запис.

## Безпека

Застосунок приватний. Google перевіряє особу, сервер додатково звіряє адресу
з дозволеним Gmail і видає захищену сесію. Секрети не зберігаються в
репозиторії. Старий застосунок залишається недоторканим до завершення тестової
міграції.


### Leads domain (2026-09-08)

- `lib/leads/domain`: validation, contact normalization, Kyiv business time,
  reminder state and derived waiting/overdue calculations. No React or D1 runtime.
- `lib/leads/application`: commands, event generation, query projections and text
  export. The authenticated user ID is supplied by the HTTP boundary, never payload.
- `lib/leads/data`: Drizzle queries over the **existing** `leads`, `students`,
  `lessons`, `activity_events` tables and new reminder/message/command tables.
- `components/leads`: list, summary, separate forms, follow-up/funnel, students,
  lesson manager, reminder slots and internal CRM conversation. React holds fetched
  views and unsaved forms only; no local database, counters or messenger integration.
- `app/api/leads`: session authentication, same-origin JSON mutations, bounded body,
  server validation and no-store responses. `GET ?overdue=true&offset=0` is the
  paginated follow-up contract for a future Today module (50 records per page).

Every command requires an idempotency key and aggregate version. A D1 batch writes
its receipt, aggregate changes and events atomically. A database trigger rejects a
stale version before any command can commit; concurrent bookings cannot overwrite
one another. A retry with the same key and payload returns the original lead ID.
The API returns 409 on stale versions, duplicate contact conflicts and reused keys.
Duplicates are matched across active AND archived leads. Creating another contact
with the same phone/username requires explicit `possible` or `confirmed` duplicate
state. Existing imported duplicates are neither deleted nor merged automatically.

A lead owns many students and lessons. A booking adds a lesson to that lead.
Rescheduling closes the old lesson as `rescheduled`, creates a replacement with
`rescheduled_from_id`, retains the original booking business date and emits only
`lesson_rescheduled`. It does not inflate booking conversion metrics. The two
reminder slots retain enabled/offset settings; the replacement gets fresh sent/
skipped markers. Missing lesson details produce `needs-data` and no complete text.
Sending is manual; no message is sent to any external service by a CRM command.

`activity_events` remains the only conversion metric source. Archive/restore never
cancels response/booking events. Explicit corrections to response or booking dates
adjust the one canonical metric event's `event_date`, with an additional audit event
retaining old/new dates. First-reply time is recorded explicitly and independently
from internal conversation messages. Unknown imported response times remain null;
waiting duration is not fabricated from technical import timestamps.

The old lead-level booking/meeting fields remain for compatibility with backups;
new lesson workflows read/write `lessons`, not those legacy summary fields. Imported
`scheduled` statuses and dotted lesson dates are adapted on reads, without rewriting
historical rows. SQL migrations in `migrations/` are authoritative. Drizzle currently
maps the Leads domain; do not use `drizzle-kit push` or apply a generated initial
schema against the existing D1 database. Other domain tables retain their existing
SQL access; their rewrite is outside this module.

Editing any part of a lead sets `managed_at`. Repeat Prototype imports use an atomic
SQL guard: a chunk touching a managed aggregate stops with an explicit conflict,
rather than overwriting cloud work. Untouched aggregates can still synchronize.
Conflict reconciliation requires a separate reviewed comparison; no silent merging
is performed. Cloud backup schema 5 includes `lesson_reminders`, `lead_messages`,
`lead_commands` and legacy import provenance/chunks alongside existing tables.

When a lead has a pending imported curator request, the booking form explicitly
selects the request to confirm. The same batch links the lesson, confirms that
request and cancels its provisional event, preserving history without counting
both pending and actual bookings. Import guards increment the aggregate version
for untouched leads too, so a concurrent cloud edit cannot overwrite a newer sync.

### Leads PR #6 hardening

Migration `0015_leads_hardening.sql` separates the transient `lead_write_guards`
compare-and-swap assertion from durable `lead_commands` receipts. Both execute in
one D1 batch with aggregate writes/events; receipts can consequently be restored
without replaying historical expected versions. The guard also verifies a selected
curator request is still pending. Existing requests can be confirmed by booking or
cancelled with a reason, retaining their events and cancelling only provisional
metrics. New curator-request creation remains outside this module.

Business-date correction decisions live in the application changeset; the
repository applies them to canonical event dates and metadata atomically. Import
guards check both incoming parents and persisted rows matched by upsert unique
keys. Import chunks are bounded to 10 records to accommodate these assertions.

`lib/backups/export.ts` owns export selections. `backup_revisions` is a technical
consistency token, updated transactionally by triggers on exported tables, including
child/provenance tables. Manifest and pages read it with their rows in one batch;
changed revisions abort a download, and the client checks final revision and counts.
It is neither an analytics counter nor a second business-data source.

`lib/leads/client` contains transport and form-value adapters, without database
access. Forms retain their original save/version snapshot. An account-scoped
session journal retains only the single unacknowledged delivery intent, removes it
after a definitive response, and survives tab reloads; cloud rows/receipts remain
authoritative. A changed form first resolves the previous command and requires review
before sending a new action. Session storage must be available for writes; clearing
browser storage or closing the session requires checking cloud history before retry.

See `docs/LEADS_PR6_REVIEW.md` for findings, verification and staging gates.
