export const APP_VERSION = '3.21.0';
export const APP_RELEASE_DATE = '2026-11-25';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Runner тепер ставиться й на Windows 11: одна команда в PowerShell з одноразовим кодом, без прав адміністратора й без Linux.',
  'Браузер runner (Edge) працює без вікна, не забирає фокус і не вмикає звуків; значок у треї показує, скільки відправлено за день.',
  'Поки автопост іде, ноутбук не засинає; у простої засинає як завжди. Runner сам піднімається після перезавантаження ПК.',
  'Кнопка «Запустити runner» у Work OS працює й на Windows. Автопост Telegram і WhatsApp доступний, Viber на Windows з’явиться в другій фазі.',
] as const;
