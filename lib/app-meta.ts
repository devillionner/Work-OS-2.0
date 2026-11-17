export const APP_VERSION = '3.18.7';
export const APP_RELEASE_DATE = '2026-11-16';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Viber із заставкою «Your Notifications are OFF» більше не зупиняє автопост: runner ставить «Please do not show me this again» і закриває її кнопкою «Назад», не вмикаючи сповіщення Android.',
  'Інші відомі заставки й реклама Viber (Got it, Not now, Skip, Remix) закриваються так само перед списком чатів.',
  'Невідоме вікно після запуску не ховається за «Viber не відповідає»: у картці й паузі написано назву вікна, а знімок екрана лежить у теці збоїв.',
] as const;
