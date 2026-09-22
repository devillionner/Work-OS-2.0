export const APP_VERSION = '0.2.17';
export const APP_RELEASE_DATE = '2026-09-23';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Після відмітки публікації завершений чат більше не стрибає нагору черги — наступний доступний лишається перед очима.',
  'Помилкову ручну публікацію можна скасувати протягом 8 секунд; Work OS повертає денний лічильник, правила частоти та Telegram-слот.',
  'Історія чату явно показує скасовані публікації та зберігає матеріал для аудиту.',
] as const;
