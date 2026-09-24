export const APP_VERSION = '0.2.59';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'WhatsApp і Viber тепер мають однаковий розгортний блок «Приєднані сьогодні».',
  'Фоновий sync автоматично сповільнюється, коли змін немає, і відступає при серверних помилках замість постійних D1-запитів.',
  'Platforms більше не завантажує інші черги наперед без дії користувача — це захищає денний D1-бюджет.',
] as const;
