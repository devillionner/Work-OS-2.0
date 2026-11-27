export const APP_VERSION = '3.23.3';
export const APP_RELEASE_DATE = '2026-11-27';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Перевстановлення Windows — одна команда: інсталятор сам ставить Node, Viber Desktop і розпізнавання тексту, налаштовує автозапуск і наприкінці каже, що лишилось (QR-входи).',
  'Інсталятор зупиняється з поясненням, якщо його запустили не з того вікна (термінал Claude), замість тихо поставити runner не туди.',
  'Telegram: оголошення у великих гілках форуму більше не стають «Не вдалося підтвердити», коли стрічка відкрилась не внизу.',
  'У журналі значка в треї видно, хто й чому перезапускав чи вимикав runner, і з яким кодом він зупинився сам.',
] as const;
