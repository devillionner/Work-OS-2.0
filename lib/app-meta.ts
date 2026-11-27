export const APP_VERSION = '3.23.8';
export const APP_RELEASE_DATE = '2026-11-27';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Картка автопосту Viber пише про Viber Desktop на Windows, а не про Waydroid і Android; з Бібліотеки прибрано старий тестовий режим Viber, який уже нічого не робив.',
  'Runner оновлюється сам: раз на 10 хвилин перевіряє версію на сайті, завантажує нову й перезапускається між задачами. Перезапускати вручну більше не треба.',
  'WhatsApp відкриває групи всередині спільнот (як «Услуги 🇪🇸 Вся Испания 🇪🇸»).',
  'Перевстановлення Windows — одна команда: інсталятор сам ставить Node, Viber Desktop і розпізнавання тексту й каже, що лишилось (QR-входи).',
  'Кнопка «Запустити runner» працює й з телефону, поки ПК увімкнений.',
] as const;
