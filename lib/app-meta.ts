export const APP_VERSION = '3.22.0';
export const APP_RELEASE_DATE = '2026-11-25';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Viber на Windows: автопост у справжні чати через програму Viber Desktop. Перед кожною відправкою Work OS читає назву відкритого чату з екрана й надсилає лише тоді, коли вона збігається.',
  'Якщо назву не вдалося прочитати чи вона інша, чат пропускається з поясненням, нічого не вводиться. Підтвердження відправки — власне повідомлення в стрічці чату.',
  'Автопост Viber не забирає в тебе вікно: якщо його дія все ж перемкнула екран, Viber одразу стає на паузу з поясненням.',
  'Автопост Viber на Windows вмикається окремо після перевірки на твоєму ПК; до того Telegram і WhatsApp працюють як раніше.',
] as const;
