export const APP_VERSION = '3.5.1';
export const APP_RELEASE_DATE = '2026-10-26';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Runner на ПК сам оновлюється після зміни коду між задачами й повідомляє, до якої версії оновився.',
  'Якщо runner чи іконка в треї впали, вони піднімаються самі, а задача, що йшла, не переривається.',
  'Коли runner вимкнений, «Сьогодні» й картки автопосту кажуть про це й дають кнопку «Запустити runner».',
  'Вимкнути runner можна лише в меню трею «Вимкнути повністю» з підтвердженням: випадково закрити його не вийде.',
] as const;
