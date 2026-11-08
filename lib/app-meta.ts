export const APP_VERSION = '3.13.0';
export const APP_RELEASE_DATE = '2026-11-08';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'У простої Work OS нічого не сповіщає: «Runner вимкнений» приходить лише коли йде партія, є задачі в черзі або запущено робочий день.',
  'Runner без партії й задач мовчить: не перевіряє Viber, Telegram і браузер, лише тримає пінг; перед партією перевіряє середовище сам.',
  'Відкриваєш картку автопосту — runner один раз перевіряє готовність, навіть коли він у простої.',
  'Вкладки Work OS у фоні нічого не перечитують, а на поверненні оновлюються один раз.',
] as const;
