export const APP_VERSION = '0.2.51';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'WhatsApp «Очікування» тепер перевіряється автоматично за безпечним серверним інтервалом, а не кожні кілька секунд.',
  'Після статусу pending наступна перевірка планується через 3 хвилини й автоматично повертається в executor queue.',
  'Графік перевірок зберігається в Work OS, тому не губиться після перезапуску runner або перемикання пристрою.',
] as const;
