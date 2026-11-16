export const APP_VERSION = '3.18.6';
export const APP_RELEASE_DATE = '2026-11-16';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'У паузі між чатами Viber «Зараз» пише «пауза між чатами · ~N с» замість «runner ще не повідомив крок».',
  'Оцінка «До кінця» стала точнішою: береться медіана інтервалів останніх чатів, а округлення до хвилини (до 15 хв) чи до 5 хв (довші) більше не завищує залишок наприкінці партії.',
] as const;
