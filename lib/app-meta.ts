export const APP_VERSION = '3.6.1';
export const APP_RELEASE_DATE = '2026-10-26';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Шкала «Сьогодні» показує кожну паузу дня штрихуванням на своєму місці, а не лише суму «пауз раніше».',
  'У списку подій дня видно, коли була пауза і скільки вона тривала.',
  'Пауза, продовження й завершення дня записуються разом, тож журнал пауз завжди збігається з активним часом.',
] as const;
