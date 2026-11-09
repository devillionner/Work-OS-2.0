export const APP_VERSION = '3.16.0';
export const APP_RELEASE_DATE = '2026-11-10';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Runner на новому ПК ставиться з сайту однією командою з одноразовим кодом: без git і без репозиторію, а прив\u2019язка до Work OS відбувається сама.',
  '«Зберегти для перенесення» шифрує входи WhatsApp, Telegram і Viber паролем на ПК і кладе архів у хмару; на новій системі інсталятор пропонує відновити їх без QR-кодів.',
  'Runner, встановлений із сайту, сам оновлюється до версії сайту, коли простоює; прогрес збереження видно в картці «Runner на цьому ПК».',
  'Непідтримувані системи (NixOS, незмінні Fedora, openSUSE) інсталятор відхиляє одразу й нічого не ставить наполовину.',
] as const;
