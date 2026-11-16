export const APP_VERSION = '3.17.4';
export const APP_RELEASE_DATE = '2026-11-16';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Поки йде автопост, біля значка runner у верхній панелі стоїть число «12/141»: скільки відправлено з усього за сьогодні.',
  'У меню значка по рядку на платформу («Viber 3 з 81 · іде», «Telegram 1 з 60 · наступна о 18:26»), «Потребують рішення» і швидкий перехід до автопосту.',
  'На GNOME браузер runner працює без вікна й не відкривається на робочому столі; для входу в WhatsApp чи Telegram є «Показати браузер runner», потім «Сховати».',
  'Android для Viber не показує вікон: запуск лише через adb, «Показати Android» лишається для ручного входу.',
] as const;
