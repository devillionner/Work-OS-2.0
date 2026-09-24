export const APP_VERSION = '0.2.69';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'WhatsApp qualification розуміє compact member counts із реального UI: 1.2K, 1,2K, 1,2 тис. та 1,2 тыс.',
  'Compact число приймається тільки поруч із factual members/participants/учасники/участники label — views та інші числа не стають кількістю учасників.',
  'Повні значення на кшталт 1 234 / 1,234 members продовжують працювати без зміни порогів 700–18 000.',
] as const;
