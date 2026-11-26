export const APP_VERSION = '3.22.4';
export const APP_RELEASE_DATE = '2026-11-26';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Viber на Windows відкриває чати лише за посиланням-запрошенням, як раніше на Android: без пошуку в списку, який плутав.',
  'Якщо Viber каже, що тебе заблокували в спільноті, чат сам іде в архів «Забанено»; недійсне посилання — в «Чат не існує».',
  'Відкриття чату за посиланням не забирає в тебе вікно й не перемикає екран.',
] as const;
