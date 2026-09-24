export const APP_VERSION = '0.2.65';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Telegram-derived Discovery тепер витрачає page budget на різні public-канали, а не на кілька постів одного й того самого каналу.',
  'Telegram usernames дедуплюються case-insensitive між t.me і telegram.me, зберігаючи перший точний post URL як provenance.',
  'Це одночасно підвищує source diversity і прибирає зайві зовнішні fetch-и без зміни D1-схеми чи polling.',
] as const;
