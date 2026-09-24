export const APP_VERSION = '0.2.55';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'У WhatsApp-чатах для публікації з’явився автопост: Work OS сам підбирає придатне оголошення з Library.',
  'Публікація зараховується тільки після підтвердженої відправки саме в потрібний чат; неправильний або read-only чат зупиняє дію.',
  'Поки автопост у черзі, ручна публікація й зміна стану чату блокуються; pending-задачу можна скасувати до старту executor.',
  'Повторний callback не створює дубль: за чат і день лишається один canonical publication fact.',
] as const;
