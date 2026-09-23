export const APP_VERSION = '0.2.28';
export const APP_RELEASE_DATE = '2026-09-23';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'WhatsApp «Очікування» має окрему чергу: видно лише запити на вступ, які ще чекають схвалення.',
  'Executor перевіряє очікуючі WhatsApp-чати першими, не змішуючи цю функцію з Viber.',
  'Discovery executor відкриває наступний WhatsApp/Viber чат і зберігає лише підтверджений результат.',
  'Вихід із чату ніколи не позначається виконаним до окремого підтвердження після фактичної дії у месенджері.',
] as const;
