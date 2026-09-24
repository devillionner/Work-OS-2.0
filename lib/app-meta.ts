export const APP_VERSION = '0.2.70';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'WhatsApp factual ads inference розпізнає більше реальних оголошень: «віддам», «обмін», «продаю», «шукаю/ищу», послуги, роботу, оренду та англомовні аналоги.',
  'Правило не послаблено: inferred_allowed потребує active chat і щонайменше два видимі ad-like messages.',
  'Один рекламний допис, неактивний чат або explicit prohibition не можуть автоматично підтвердити дозвіл оголошень.',
] as const;
