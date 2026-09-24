export const APP_VERSION = '0.2.50';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'WhatsApp executor тепер може автоматично вийти з непридатного вже приєднаного чату після перевірки точного target.',
  'Якщо WhatsApp не підтверджує правильний чат, кнопку виходу або результат виходу, автоматизація зупиняється без зміни Work OS.',
  'Ручне підтвердження виходу лишається fallback, якщо browser automation недоступна.',
] as const;
