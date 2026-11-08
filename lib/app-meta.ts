export const APP_VERSION = '3.12.0';
export const APP_RELEASE_DATE = '2026-11-08';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'У «Налаштування → Сервіс» з\u2019явився рядок «Диспетчер сьогодні»: скільки запитів до Durable Objects уже витрачено з 100 тис. за добу й що з них найбільше.',
  'Лічильник рядків бази й статуси runner шлють дані значно рідше, тож безкоштовний ліміт диспетчера більше не вичерпується.',
  'Коли набирається 70 тис. запитів за добу, приходить одне сповіщення й вмикається режим економії.',
  'Runner оновиться сам: статуси Viber, WhatsApp і Telegram він надсилає лише при зміні, а кроки однієї задачі зливає.',
] as const;
