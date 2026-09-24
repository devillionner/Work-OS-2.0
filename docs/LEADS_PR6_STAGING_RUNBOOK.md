# Leads — локальна перевірка та release gate

Оновлено 2026-09-10. Назву файла збережено для старих посилань. PR #6 вже є
в main; попередній remote-staging runbook не є чинною інструкцією для тестів.
Усі репетиції виконуються локально, без production/staging D1 та щоденного resync.

## Локальний набір

```sh
npm ci
npm run verify
```

Tests створюють ізольовані Miniflare бази й синтетичні дані; Cloudflare login не
потрібен. Локальний preview використовує DB binding без remote connection.
Деталі: [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md).

## Сценарії даних

1. Локально застосувати SQL-міграції на окремому fixture; звірити збереження
   полів/nullable legacy dates, FK та подієвих показників. Не змінювати вихідний файл.
2. Кілька учнів на контакт, повторний запис, linked reschedule, архів/відновлення,
   pending curator confirm/cancel, неповний урок, невідомі бізнес-дати, дублі.
3. Повторна команда з тим самим idempotency key не додає запис/подію. Stale version
   або curator race відхиляється атомарно; помилка batch не лишає часткового уроку.
4. Повторний synthetic legacy import зупиняється на managed conflict; попередні
   порції лишаються видимими, невдала порція відміняється повністю.
5. Cloud backup schema 6 та сумісність 5: checksum/counts/ownership/FK, revision
   conflict, local round-trip усіх полів/provenance/soft-deleted messages/receipts.
   Receipt після restore не створює ще один урок. Не відновлювати ephemeral guards.
6. Missing-only restore не перезаписує існуючі рядки, не видаляє відсутні в backup,
   блокує чужого власника/зіпсовані chunks. Це не exact rollback живої бази.

## Ручна QA локального preview

- Desktop: пошук/фільтри, create/edit/archive/restore, учні, повторний урок,
  перенесення, нагадування sent/skipped/needs-data, follow-up, curator, TXT export.
- Помилки: stale form, невідомий результат доставки/reload, подвійний клік,
  довгі назви/URL, порожні/некоректні поля. Форма зберігає дані після відмови.
- Keyboard: focus при відкритті, tab order, Escape, focus containment і повернення
  після save/error, відсутність випадкових дій у фоні.
- Mobile: ті самі основні дії, 44 px touch-цілі, відсутність перекриття контенту
  навігацією/клавіатурою. Вузький viewport не замінює Safari на iPhone.

Записати commit, набір fixture та результати; не називати непроведену QA успішною.
Remote staging не використовується як обхід проблем локального preview.

## Release та фінальний перенос

Локальні тести — gate для commit/push, а не deploy. Контрольована публікація
перевіряє environment до build, згенеровану конфігурацію і план rollback.
Production SQL/дані потребують прямого дозволу; фінальний transfer — ще й
functional parity. Свіжий реальний snapshot створюється для погодженого переносу,
не для повторення тестів. Чинні критерії: [ROADMAP](ROADMAP.md).
