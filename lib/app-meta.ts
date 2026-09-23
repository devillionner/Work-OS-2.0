export const APP_VERSION = '0.2.22';
export const APP_RELEASE_DATE = '2026-09-23';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Помилка публікації тепер показує точне пояснення сервера прямо в модалці, а не загальне повідомлення.',
  'Якщо стан чату змінився на іншому клієнті, застаріла модалка закривається після оновлення списку й не дозволяє повторювати дію зі старим станом.',
] as const;
