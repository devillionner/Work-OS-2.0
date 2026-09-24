export const APP_VERSION = '0.2.56';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Посилання WhatsApp-чатів із Work OS тепер одразу відкриваються у WhatsApp Web без проміжної invite-сторінки.',
  'Код запрошення переноситься напряму у web.whatsapp.com/accept, тому браузер не пропонує відкривати desktop WhatsApp.',
  'Інші платформи зберігають попередню поведінку відкриття.',
] as const;
