-- Оголошення Бібліотеки для автопосту: охоплення й власне фото. Лише додаємо колонки зі сталими значеннями за замовчуванням: SQLite не перечитує наявні рядки, бекфілів немає.
-- scope: 'wide' (за замовчуванням: йде в чати свого напряму й без напряму) або 'exclusive' (лише в чати з цим напрямом).
-- image_key: SHA-256 фото оголошення (порожньо — фото немає); самі байти лежать у user_settings `library_ad_image_v1:<id>`, як і фото автопосту.
ALTER TABLE library_items ADD COLUMN scope TEXT NOT NULL DEFAULT 'wide';
ALTER TABLE library_items ADD COLUMN image_key TEXT;
