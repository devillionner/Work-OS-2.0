-- Суворі правила профілю чату для автопосту. Лише додаємо колонки зі сталими значеннями за замовчуванням: SQLite не перечитує наявні рядки.
-- directions_strict: чат отримує лише оголошення своїх «Цільових напрямків» (інший напрям не підставляється).
-- pinned_ads_json: id оголошень Бібліотеки (і текстів пулу Telegram), які чат отримує по черзі; мають пріоритет над напрямами.
-- no_photo: для цього чату автопост завжди надсилає лише текст; no_photo_auto: позначку поставив автопост, коли побачив технічну заборону медіа.
ALTER TABLE chat_profiles ADD COLUMN directions_strict INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_profiles ADD COLUMN pinned_ads_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE chat_profiles ADD COLUMN no_photo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_profiles ADD COLUMN no_photo_auto INTEGER NOT NULL DEFAULT 0;
