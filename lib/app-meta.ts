export const APP_VERSION = '3.22.1';
export const APP_RELEASE_DATE = '2026-11-26';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Runner на Windows більше не ламається під час самооновлення: раніше оновлення видаляло його власні файли, і автопост зупинявся.',
  'Після повторного встановлення runner оновлюватиметься сам, як і на Linux, без втрати входів у WhatsApp і Telegram.',
  'Viber на Windows: автопост через Viber Desktop із перевіркою назви чату з екрана; вмикається окремо після перевірки на твоєму ПК.',
] as const;
