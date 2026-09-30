export const APP_VERSION = '0.2.87';
export const APP_RELEASE_DATE = '2026-09-30';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Перевірка WhatsApp «Очікування» більше не залежить від проблемного поля повторної перевірки в D1.',
  'Кнопка «Перевірити зараз» формує batch через стабільні поля, які вже є в основній схемі.',
  'Зупинка batch тепер одразу скасовує навіть уже взяту в lease перевірку, не змінюючи чат помилково.',
] as const;
