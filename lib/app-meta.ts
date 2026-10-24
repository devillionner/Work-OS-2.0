export const APP_VERSION = '3.3.2';
export const APP_RELEASE_DATE = '2026-10-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'В автопості Telegram можна обрати фото й текст: свої, окремі від WhatsApp і Viber, або одним кліком узяти їхні.',
  'Фото необов’язкове. Без свого тексту береться оголошення з Бібліотеки для кожного чату, і воно йде підписом до фото.',
  'Підпис до фото в Telegram — до 1024 символів, без фото до 4096. Довгий текст не обрізається: такі чати план показує окремо й не надсилає.',
] as const;
