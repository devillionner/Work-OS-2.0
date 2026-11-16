export const APP_VERSION = '3.17.1';
export const APP_RELEASE_DATE = '2026-11-16';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Вхід через Google тепер працює в будь-якому браузері, зокрема у Flow Browser: кнопка «Увійти через Google» веде звичайним перенаправленням, а не спливним вікном.',
  'Помилки входу показуються зрозумілим текстом на екрані входу: вхід скасовано, час минув, акаунт без доступу.',
  'Поки секрет входу не додано, екран входу показує стару кнопку Google і нічого не ламається.',
] as const;
