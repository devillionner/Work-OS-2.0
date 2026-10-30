export const APP_VERSION = '3.7.1';
export const APP_RELEASE_DATE = '2026-10-26';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Автопост у WhatsApp і Telegram працює у фоновій вкладці Opera: не піднімає вікна, не забирає фокус і не видає звуків.',
  'Якщо Opera запущена без прапорців проти гальмування прихованих вікон, у картці й меню трею з’являється підказка перезапустити її.',
  'Вікно Android для Viber більше не відкривається саме: при запиті Allow приходить сповіщення, а вікно відкриває кнопка в картці.',
] as const;
