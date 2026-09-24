export const APP_VERSION = '0.2.61';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Робочий день більше не читає D1 кожні 5 секунд безперервно: після незмінного стану синхронізація сповільнюється до 15–60 секунд.',
  'Viber safe-mode перевіряє лише свою конкретну задачу й теж переходить на адаптивний backoff замість 2-секундного polling.',
  'При серверних помилках обидва фонові процеси відступають до 5 хвилин, не створюючи retry storm.',
] as const;
