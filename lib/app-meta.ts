export const APP_VERSION = '0.2.88';
export const APP_RELEASE_DATE = '2026-09-30';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Виправлено реальну причину падіння «Перевірити зараз»: SQL більше не звертається до неіснуючого chats.left_at.',
  'Старі batch-маркери архівних/залишених чатів більше не тримають перевірку активною.',
  'Повторні спроби перевірки тепер мають паузу 5/10 хвилин і не забивають чергу кожним poll.',
] as const;
