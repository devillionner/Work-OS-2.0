export const APP_VERSION = '3.2.24';
export const APP_RELEASE_DATE = '2026-10-18';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Автопост WhatsApp і Viber знову стартує: після оновлення сайту черга могла зависнути на задачі, яку runner уже не виконував. Тепер така задача сама повертається в чергу.',
  'Дошка «Розробка»: запис знову переноситься на інший етап, навіть у порожню колонку (раніше картка поверталась на місце).',
  'Перетягування карток у Бібліотеці й дошці тепер ставить картку точно: на нижню половину іншої картки означає «після неї», а не «у кінець».',
] as const;
