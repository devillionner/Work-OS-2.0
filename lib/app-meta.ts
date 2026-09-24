export const APP_VERSION = '0.2.66';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Discovery source search більше не крутиться кожні 3 секунди: порожній source-advance має мінімум 60 секунд до наступного.',
  '3-секундний цикл зберігається лише для реальної messenger task або щойно знайденого кандидата, щоб join/inspect не затримувався.',
  'Non-interactive runner без WhatsApp CDP не накопичує нові join tasks, а один source-advance обробляє менший bounded batch.',
] as const;
