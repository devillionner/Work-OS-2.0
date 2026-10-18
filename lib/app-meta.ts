export const APP_VERSION = '3.2.26';
export const APP_RELEASE_DATE = '2026-10-18';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'З’явилась публічна демо-версія з вигаданими даними: друзі можуть потикати всі розділи за посиланням, без входу.',
  'У демо автопост, runner, резервні копії й вихід не виконуються: кнопки видно, а замість дії показується «У демо-версії недоступно».',
  'Демо щоночі повертається до початкового стану й має ліміти запитів, тож не зачіпає ні справжні дані, ні спільний ліміт бази.',
] as const;
