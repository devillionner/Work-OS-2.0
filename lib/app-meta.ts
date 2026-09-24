export const APP_VERSION = '0.2.72';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'WhatsApp Web snapshot передає реальний browser locale, щоб неоднозначні дати повідомлень не вгадувалися.',
  'Для en-US 09/01 читається як September 1; для uk-UA — як 9 січня відповідно до фактичного locale date order.',
  'Якщо дата неоднозначна і locale невідомий, activity лишається unknown замість потенційно хибного active/dead.',
] as const;
