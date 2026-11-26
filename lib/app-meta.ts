export const APP_VERSION = '3.22.12';
export const APP_RELEASE_DATE = '2026-11-26';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Viber на Windows більше не зупиняється на «Не той чат», коли в назві є прапорці чи емодзі й з екрана вдається прочитати лише перше слово: чат, відкритий своїм посиланням, упізнається за початком назви.',
  'Viber на Windows впізнає чат за його посиланням-запрошенням, навіть коли назву з екрана видно погано (українські літери, емодзі).',
  'Для Viber більше немає кнопки «оновити назву»: вона могла перейменувати чат на неправильно прочитаний текст. Замість неї — «Спробувати ще».',
] as const;
