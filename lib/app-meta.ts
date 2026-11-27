export const APP_VERSION = '3.23.1';
export const APP_RELEASE_DATE = '2026-11-27';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Кнопка «Запустити runner» з телефону справді запускає runner: команда доходила до ПК, але значок у треї з неї не стартував.',
  'На ПК кнопка запускає runner одразу двома шляхами, тож спрацьовує навіть тоді, коли чергова програма ще не оновилась.',
  'Якщо ПК не відповідає, кнопка прямо каже, що він вимкнений чи спить, а не показує помилку Safari.',
] as const;
