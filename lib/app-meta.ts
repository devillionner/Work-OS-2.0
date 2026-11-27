export const APP_VERSION = '3.23.0';
export const APP_RELEASE_DATE = '2026-11-27';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Кнопка «Запустити runner» тепер працює й з телефону: команда йде через Work OS на ПК, навіть якщо runner вимкнули повністю. Головне, щоб ПК був увімкнений.',
  'Якщо ПК не відповідає, кнопка прямо каже, що він вимкнений, спить або на ньому ще стара версія runner, а не показує помилку Safari.',
  'Viber на Windows більше не зупиняється на «Не той чат», коли в назві є прапорці чи емодзі.',
] as const;
