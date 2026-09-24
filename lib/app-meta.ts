export const APP_VERSION = '0.2.63';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Telegram-derived автопошук використовує і українську, і Latin-назву міста, якщо вони відрізняються — наприклад «Берлін» та «Berlin».',
  'Строгі city-alias запити виконуються перед ширшим WhatsApp fallback і зупиняються одразу, коли набрано достатньо public sources.',
  'Кількість web-запитів лишається bounded: максимум три search variants на один seed task і попередній pageLimit для Telegram history.',
] as const;
