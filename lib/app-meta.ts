export const APP_VERSION = '3.7.2';
export const APP_RELEASE_DATE = '2026-10-26';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Чат, де адміни заборонили писати, тепер іде в архів «Пишуть лише адміни», а не відкладається щодня.',
  'Якщо в WhatsApp тебе вилучили з групи чи заявка без відповіді, чат архівується або йде в «Очікування» з правильною причиною.',
  'Чат, стан якого автопост так і не зміг визначити, більше не зникає тихо на день: він потрапляє в «Потребують рішення».',
  'Відкриття чату у WhatsApp Web пробується двічі, тому менше хибних збоїв, поки Opera прихована.',
] as const;
