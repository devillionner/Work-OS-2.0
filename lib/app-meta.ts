export const APP_VERSION = '0.2.52';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Нові WhatsApp-чати з Discovery тепер автоматично додаються на перевірку без окремого натискання кнопки.',
  'Після додавання чат одразу потрапляє в executor queue для join/check через WhatsApp Web.',
  'Недійсний або недоступний invite після фактичної перевірки автоматично архівується без помилкового зарахування вступу.',
] as const;
