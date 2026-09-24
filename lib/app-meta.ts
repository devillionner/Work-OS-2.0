export const APP_VERSION = '0.2.71';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'WhatsApp activity parser коректно читає year-first metadata на кшталт 2026-09-24 замість часткового збігу всередині року.',
  'DD/MM/YYYY, MM/DD/YYYY та локальні роздільники зберігають попередню bounded ambiguity-логіку.',
  'Неіснуючі календарні дати на кшталт 31/02 не можуть бути автоматично нормалізовані у factual active/dead evidence.',
] as const;
