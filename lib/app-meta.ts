export const APP_VERSION = '0.2.74';
export const APP_RELEASE_DATE = '2026-09-30';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Пошук чатів більше не показує один і той самий результат двічі між поточним запуском і збереженою історією.',
  'Екран автопошуку чіткіше розділяє поточний прогрес, ручну перевірку, цільові та відсіяні чати.',
  'Основні дії для ручної перевірки й цільових чатів тепер доступні прямо на картці без прихованого меню.',
  'Модалка автопошуку тепер коректно вкладається у narrow/mobile viewport, а ключові touch-дії мають більші зони натискання.',
] as const;
