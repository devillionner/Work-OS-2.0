export const APP_VERSION = '0.2.62';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Автопошук WhatsApp-чатів розширює Telegram/t.me пошук другим bounded-запитом лише коли строгий пошук не дав достатньо джерел.',
  'Публічні Telegram-канали читаються через history preview t.me/s, тому старіші повідомлення з WhatsApp invite мають більше шансів потрапити в Discovery.',
  'Приватні Telegram invite, internal c-links та службові Telegram URL не обходяться як public sources.',
] as const;
