export const APP_VERSION = '0.2.33';
export const APP_RELEASE_DATE = '2026-09-23';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Platforms більше не перемонтовується після архівації, публікації або фонового sync — список не повинен зникати й показувати великий loader.',
  'Після дії Work OS тихо перечитує актуальні чати та лічильники, зберігаючи поточну чергу, scroll і стан інтерфейсу.',
  'Cross-device sync для Platforms тепер оновлює дані без скидання локального стану сторінки.',
  'Адаптація списку й окремий діалог архівації з попередніх оновлень збережені.',
] as const;
