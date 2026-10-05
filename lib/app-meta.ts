export const APP_VERSION = '0.2.108';
export const APP_RELEASE_DATE = '2026-10-05';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Автопошук тепер переглядає більше груп за один крок пошуку в Telegram (було 3, тепер до 12) — має знаходити більше чатів за той самий час.',
  'У вікні автопошуку тепер видно прогрес усередині кроку — скільки груп уже перевірено й скільки посилань знайдено, ще до перевірки у WhatsApp.',
  'Якщо вступ у підходящий чат потребує схвалення адміністратора, автопошук тепер надсилає запит і показує чат для рішення — раніше він просто губився.',
] as const;
