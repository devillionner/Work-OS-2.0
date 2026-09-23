export const APP_VERSION = '0.2.29';
export const APP_RELEASE_DATE = '2026-09-23';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Platforms краще адаптується до вузького desktop: пошук, профільні фільтри та дії чатів більше не стискають список по горизонталі.',
  'На narrow desktop дії чату переносяться під його назву та посилання, зберігаючи повнорозмірні кнопки.',
  'WhatsApp «Очікування» має окрему чергу: видно лише запити на вступ, які ще чекають схвалення.',
  'Executor перевіряє очікуючі WhatsApp-чати першими, не змішуючи цю функцію з Viber.',
] as const;
