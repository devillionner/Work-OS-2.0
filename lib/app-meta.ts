export const APP_VERSION = '0.2.21';
export const APP_RELEASE_DATE = '2026-09-23';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Кнопка швидкого скасування публікації тепер зникає точно разом із серверним 8-секундним вікном.',
  'Інтерфейс більше не обіцяє скасування після того, як сервер уже не може безпечно його виконати.',
] as const;
