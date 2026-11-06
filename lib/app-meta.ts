export const APP_VERSION = '3.11.3';
export const APP_RELEASE_DATE = '2026-11-06';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Після натискання «Прибрати дублікати» рамка зникає одразу, а на її місці лишається один чат; «Скасувати» в Toast повертає пару.',
  'Група «Вибрати гілку» і її лічильник оновлюються після злиття, тож стара копія більше не повертає рамку.',
  'У рамці угорі стоїть чат, що лишиться, з усіма діями; нижче компактні рядки копій з міткою «Буде прибрано» і кнопкою «Лишити цей».',
] as const;
