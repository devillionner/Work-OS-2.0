export const APP_VERSION = '0.2.68';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'WhatsApp Web qualification тепер може фактично підтвердити українську тематику з observed назви/опису чату, а не лише відхиляти очевидний mismatch.',
  'Позитивний topic match вимагає сильного Ukrainian identity signal; generic group name лишається unknown.',
  'Crypto/casino/spam evidence має пріоритет над українською назвою й лишається topic mismatch.',
] as const;
