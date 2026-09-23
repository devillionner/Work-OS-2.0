export const APP_VERSION = '0.2.24';
export const APP_RELEASE_DATE = '2026-09-23';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Модальні вікна більше не запускають повторне закриття для тієї самої дії.',
  'Закриття через хрестик, Esc або фон тепер проходить через один узгоджений перехід стану.',
] as const;
