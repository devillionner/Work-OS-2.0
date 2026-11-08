export const APP_VERSION = '3.14.0';
export const APP_RELEASE_DATE = '2026-11-09';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Runner ставиться на новий Linux однією командою: інсталятор сам визначає Arch, Fedora чи Ubuntu, ставить браузер, Waydroid із Viber і трей та наприкінці показує перевірку готовності.',
  'Архів перенесення зберігає сесії WhatsApp, Telegram і Viber під паролем: на новій системі їх відновлюють без QR-кодів.',
  'У «Налаштування → Сервіс» з\u2019явився рядок «Runner на цьому ПК» зі станом, версією й командами встановлення та перевірки.',
  'Опис усього, на чому тримається runner, лежить у docs/RUNNER-SETUP.md.',
] as const;
