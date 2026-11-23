export const APP_VERSION = '3.19.1';
export const APP_RELEASE_DATE = '2026-11-23';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Злиття дублікатів чатів стало легшим для бази: переносяться події лише цього чату, а не всі події власника (раніше одне злиття читало ≈ 9 тис. рядків).',
  'Так само звужено перенесення слотів розкладу Telegram при злитті, тож масове злиття більше не з’їдає добовий ліміт читань.',
] as const;
