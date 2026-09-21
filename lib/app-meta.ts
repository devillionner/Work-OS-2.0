export const APP_VERSION = '0.2.14';
export const APP_RELEASE_DATE = '2026-09-21';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Великі запити, CSV та резервні копії тепер перевіряються за лімітом ще під час отримання, а не після повного читання.',
  'Це зменшує ризик зайвого навантаження від завеликих або chunked-запитів без зміни звичайної роботи Work OS.',
] as const;
