export const APP_VERSION = '3.19.2';
export const APP_RELEASE_DATE = '2026-11-23';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Viber-автопост більше не видає звуків на ПК: Android у Waydroid сам тримає тишу (звук відправки, сповіщення, дотики), і так після кожного перезапуску сесії.',
  'Перенесення на нову систему вимикає звуки Android уже під час встановлення runner, нічого робити вручну не треба.',
] as const;
