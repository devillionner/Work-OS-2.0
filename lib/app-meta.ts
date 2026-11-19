export const APP_VERSION = '3.18.9';
export const APP_RELEASE_DATE = '2026-11-19';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Один мертвий чат у Viber більше не зупиняє всю чергу: якщо пробна відправка в My Notes проходить, такий чат пропускається, а решта йде далі.',
  'Пробна відправка перевіряє відкриття запрошення лише на чаті, що сьогодні вже відкривався, а не на першому в черзі.',
  'Два чати поспіль, що не відкрились, ставлять паузу лише коли й пробна відправка в My Notes не проходить.',
  'Банер «Notifications are OFF!» на списку чатів Viber не вважається заставкою, кнопка «Turn on» не натискається.',
] as const;
