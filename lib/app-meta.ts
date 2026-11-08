export const APP_VERSION = '3.12.2';
export const APP_RELEASE_DATE = '2026-11-08';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Прибрано внутрішні лічильники бази й диспетчера: ліміти тепер дивимось лише в панелі Cloudflare, а Work OS не витрачає їх на власний облік.',
  'Зі «Сервісу» зникли рядки «База сьогодні» й «Диспетчер сьогодні», а звичайний запит сторінки більше не звертається до Durable Object.',
  'Runner шле статуси лише при зміні, зливає часті кроки однієї задачі, а будильник перевірки runner спрацьовує рідше, коли задач немає.',
] as const;
