export const APP_VERSION = '0.2.53';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Автопошук WhatsApp тепер запускається однією кнопкою: міста й ключові запити система бере сама.',
  'Ціль пошуку рахується за новими підтвердженими цільовими чатами, а не за кількістю знайдених посилань.',
  'Telegram/public sources проходяться автоматично; відомі, архівовані та відхилені чати не ставляться на повторний вступ.',
  'Якщо доступні джерела вичерпано раніше за ціль, Work OS показує фактичний результат замість вигаданого успіху.',
] as const;
