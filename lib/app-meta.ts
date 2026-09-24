export const APP_VERSION = '0.2.54';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'WhatsApp-перевірка тепер бере справжню назву групи з точного invite і не залежить від приблизної назви з джерела.',
  'Після вступу Work OS автоматично читає кількість учасників, активність, можливість писати, правила реклами та очевидні spam-сигнали.',
  'Чати з admin-only, забороною реклами, спамом, невідповідною кількістю учасників або підтверджено давно неактивні автоматично відсіюються.',
  'Якщо фактів ще недостатньо, чат лишається на bounded повторній перевірці замість помилкового target або нескінченного tight loop.',
] as const;
