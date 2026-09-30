export const APP_VERSION = '0.2.86';
export const APP_RELEASE_DATE = '2026-09-30';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Виправлено запуск «Перевірити зараз» у WhatsApp «Очікування»: помилка JSON більше не зриває перевірку.',
  'Пакет заявок формується кількома set-based D1 запитами замість сотень окремих записів.',
  'Навіть при серверній помилці Work OS показує зрозуміле повідомлення й не губить стан черги.',
] as const;
