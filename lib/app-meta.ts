export const APP_VERSION = '0.2.9';
export const APP_RELEASE_DATE = '2026-09-21';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Пошук чатів тепер відстежує, чи запит на вступ очікує схвалення, чи чат уже приєднано.',
  'Після перевірки цільовий чат переходить до роботи, а нецільовий не ховається, доки вихід із месенджера не підтверджено.',
  'Недійсні посилання до вступу безпечно переносяться в архів, а невідомі правила лишають чат на кваліфікації.',
] as const;
