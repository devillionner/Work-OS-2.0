export const APP_VERSION = '3.17.3';
export const APP_RELEASE_DATE = '2026-11-16';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Поки йде автопост, ноутбук не засинає: runner тримає блокування сну і знімає його, щойно партія й усі задачі закінчились.',
  'Екран гаснути може; кришку і живлення система обробляє як і раніше, блокується лише автоматичний сон.',
  'В іконці трея з’являється рядок «Не даю заснути: іде автопост», поки блокування стоїть.',
  'У простої блокування немає, а якщо runner завершився аварійно, система сама його знімає.',
] as const;
