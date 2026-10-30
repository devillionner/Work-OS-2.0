export const APP_VERSION = '3.5.0';
export const APP_RELEASE_DATE = '2026-10-26';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Дублікати чатів зливаються: копія видаляється, а уся її історія (публікації, події, джерело лідів, розклад) переходить на основний чат.',
  'Дублікати шукаються по всіх акаунтах Telegram, а один чат більше не можна додати вдруге ні списком, ні з «Відібраних».',
  'Менеджер дублікатів відкривається швидко: читає лише позначені чати, а не всю базу.',
] as const;
