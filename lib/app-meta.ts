export const APP_VERSION = '3.5.2';
export const APP_RELEASE_DATE = '2026-10-26';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Сповіщення на телефон: у «Налаштуваннях» можна ввімкнути push, пробне сповіщення перевіряє зв’язок.',
  'Приходить повідомлення, коли runner вимкнений понад 10 хв, WhatsApp чи Telegram Web вийшли із сесії або партія стоїть понад 15 хв.',
  'Коли партія автопосту завершилась, у сповіщенні одразу видно підсумок, наприклад «Viber: 74 з 79, 5 потребують рішення».',
  'Клік по сповіщенню відкриває потрібну картку автопосту; вночі й частіше разу на 30 хв сповіщення не приходять.',
] as const;
