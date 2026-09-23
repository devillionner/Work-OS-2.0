export const APP_VERSION = '0.2.26';
export const APP_RELEASE_DATE = '2026-09-23';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Зовнішні executor-пристрої більше не можуть одночасно забрати одну й ту саму задачу пошуку чатів.',
  'Зависла задача автоматично звільняється через короткий lease, а відкликання пристрою звільняє її одразу.',
] as const;
