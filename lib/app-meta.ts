export const APP_VERSION = '3.4.2';
export const APP_RELEASE_DATE = '2026-10-26';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'У WhatsApp «відправлено» тепер лише коли біля повідомлення з фото з’явилась галочка, а не коли зникла іконка годинника.',
  'Автопост не йде з чату, поки там є повідомлення без галочки, і більше не перезавантажує WhatsApp між чатами.',
  'Після кожної відправки в WhatsApp вкладка ще 30 секунд лишається в чаті, і лише потім відкривається наступний.',
  'Повідомлення, які раніше тільки здавались відправленими, перевірено в чатах і відправлено наново.',
] as const;
