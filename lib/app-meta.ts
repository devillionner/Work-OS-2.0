export const APP_VERSION = '3.2.25';
export const APP_RELEASE_DATE = '2026-10-18';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Автопост Viber і WhatsApp знову бере задачі: після оновлення бази сервер вважав кожну взяту в роботу задачу невдалою, і черга стояла.',
  'Viber сам піднімає Waydroid, якщо його не запущено або Android завис, і чекає, поки він завантажиться.',
  'Якщо зв’язок runner з сайтом обірвався під час відправки, результат не губиться, а задача не виконується вдруге.',
  'Кнопки «Зупинити» і «Скинути чергу» тепер показують правильну кількість скасованих задач.',
] as const;
