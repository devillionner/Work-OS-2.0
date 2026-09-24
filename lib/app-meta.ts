export const APP_VERSION = '0.2.67';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Фоновий Discovery runner без WhatsApp CDP тепер завершується до першого Work OS/D1 poll замість марного фонового циклу.',
  'Якщо WhatsApp Web розлогінений, page/CDP не готові або CDP відвалився, новий source crawl ставиться на 5-хвилинний cooldown.',
  'Успішна підтверджена WhatsApp дія знімає runtime block; task-specific неоднозначність і далі fail-closed не створює вигаданих фактів.',
] as const;
