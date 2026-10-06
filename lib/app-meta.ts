export const APP_VERSION = '0.2.113';
export const APP_RELEASE_DATE = '2026-10-06';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'У вікні автопошуку тепер відразу видно, якщо вже є чати, готові до підтвердження, навіть коли відкрита інша вкладка.',
  'Через тиждень після завершення плану пошуку зʼявляється кнопка «Шукати ще раз» — автопошук перевірить ті самі Telegram-групи на нові WhatsApp-запрошення, не чіпаючи вже відомі.',
  'Виправлено рідкісний недогляд, через який деякі WhatsApp-запрошення в Telegram-повідомленнях губилися й не потрапляли в результати пошуку.',
] as const;
