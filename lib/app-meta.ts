export const APP_VERSION = '3.22.10';
export const APP_RELEASE_DATE = '2026-11-26';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Viber на Windows впізнає чат, навіть коли з екрана не читаються українські слова з «і»: менше хибних «Не той чат».',
  'Для Viber більше немає кнопки «оновити назву»: вона могла перейменувати чат на неправильно прочитаний текст. Замість неї — «Спробувати ще».',
  'Якщо Viber сам вискочить наперед, Work OS одразу повертає тобі твоє вікно.',
  'Пробна відправка відкриває «My Notes» кнопкою над списком чатів, а не пошуком, тож не зависає.',
] as const;
