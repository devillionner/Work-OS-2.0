export const APP_VERSION = '3.16.7';
export const APP_RELEASE_DATE = '2026-11-13';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'У «Не той чат» на сторінці вступу Viber видно назву, яку показав Viber: «У Work OS: … · у Viber: …», і головна дія «Це той самий чат: оновити назву й опублікувати».',
  'Після оновлення назви автопост вступає в чат за запрошенням і публікує, як у звичайному неприєднаному чаті.',
  '«Спробувати ще» (і «Спробувати ще всі») для такого випадку прибрано: без зміни назви воно щоразу давало той самий збій.',
  'Те саме для WhatsApp: назва, яку показав WhatsApp Web, тепер доходить до списку рішень, а не губиться.',
] as const;
