export const APP_VERSION = '0.2.36';
export const APP_RELEASE_DATE = '2026-09-23';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Після підтвердженої публікації Platforms одразу оновлює статус чату, доступні/опубліковані сьогодні та денну ціль без F5.',
  'Скасування публікації симетрично повертає чат, оголошення та Telegram-розклад у попередній стан.',
  'Today, Reports, Analytics і Library автоматично перечитують авторитетні дані після publication/correction та між вкладками.',
  'Перехід робочої дати опівночі за Києвом автоматично оновлює денні показники без ручного перезавантаження.',
  'Невизначений мережевий результат публікації спочатку звіряється із сервером, щоб повтор не створював хибний стан.',
] as const;
