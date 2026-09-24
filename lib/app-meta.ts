export const APP_VERSION = '0.2.64';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Якщо перша public Telegram preview не містить WhatsApp invite, Discovery може перевірити рівно одну старішу history-сторінку того самого каналу.',
  'History follow-up приймає тільки same-channel ?before= cursor; newer/foreign/private Telegram links ігноруються.',
  'Додатковий crawl жорстко bounded: максимум +1 Telegram history fetch на seed task і жодної рекурсивної пагінації.',
] as const;
