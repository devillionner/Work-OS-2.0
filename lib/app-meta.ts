export const APP_VERSION = '3.17.5';
export const APP_RELEASE_DATE = '2026-11-16';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Автопост Viber знову натискає «Send»: адаптер правильно читає розташування кнопки на екрані Android, і підпис разом із фото відправляються.',
  'Клавіатура ADBKeyBoard вмикається сама: якщо вона встановлена, але вимкнена, runner її вмикає, а в картці автопосту є окреме пояснення, коли не вийшло.',
  'Рекламні панелі Viber («Remix», «Got it») закриваються самі й не блокують відправку та підтвердження.',
  'Telegram: після відправки з фото зайві вікна «Send Photo» закриваються без відправки, а повторна вставка фото робиться лише коли жодного вікна немає.',
] as const;
