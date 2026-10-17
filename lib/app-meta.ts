export const APP_VERSION = '3.2.11';
export const APP_RELEASE_DATE = '2026-10-17';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Автопост Viber тепер працює через Android у Waydroid: Work OS відкриває кожен чат за посиланням і надсилає фото з підписом одним повідомленням.',
  'Фото одне на WhatsApp і Viber, його додають на вкладці «Автопост» у WhatsApp; підпис для Viber береться з Бібліотеки.',
  'Картка Viber показує, чи готові Waydroid і Viber на ПК, і пояснює, що виправити; відправка йде у фоні, ПК можна використовувати як зазвичай.',
  'Чат, у якому заголовок не збігається з назвою, пишуть лише адміни, або який не знайдено, автопост пропускає без відправки й обробляє за тими самими правилами, що й WhatsApp.',
] as const;
