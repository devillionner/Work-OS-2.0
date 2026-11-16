// Одна оцінка часу партії автопосту для всіх місць (3.18.4): картка до запуску, «До кінця», сповіщення «почався», трей.
// Залишок × середній фактичний час на чат за останні задачі платформи сьогодні (інтервали між завершеннями, з паузами темпу);
// до перших задач — довідкова швидкість платформи з урахуванням темпу, плюс пробна відправка, якщо вона ще попереду.
// Округлення вгору до 5 хвилин; формат «≈ 50 хв · до 21:30».

/** Довідкова швидкість без пауз: за вимірами партій 16.11 (Viber ≈ 35–40 с на чат). */
export const REFERENCE_SECONDS = { viber: 40, whatsapp: 45, telegram: 15 };
/** Скільки триває пробна відправка перед першою партією платформи. */
export const CANARY_SECONDS = { viber: 30, whatsapp: 25, telegram: 15 };
/** Скільки останніх інтервалів беремо для середнього. */
export const RECENT_TASKS = 10;

/**
 * @param {'viber'|'whatsapp'|'telegram'} platform
 * @param {number[]} finishedAt моменти завершення задач сьогодні, мс (будь-який порядок)
 * @param {number} [perHour] темп (відправок на годину), 0 або порожнє — без пауз
 */
export function secondsPerChat(platform, finishedAt = [], perHour = 0) {
  const times = [...finishedAt].filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => b - a).slice(0, RECENT_TASKS + 1);
  if (times.length >= 3) {
    const span = (times[0] - times[times.length - 1]) / 1000;
    const average = span / (times.length - 1);
    if (average >= 3 && average < 3600) return average;
  }
  const paced = perHour > 0 ? Math.round(3600 / perHour) : 0;
  return Math.max(REFERENCE_SECONDS[platform] ?? 40, paced);
}

/** Хвилини, округлені вгору до 5 (не менше 5). */
export const roundMinutes = (seconds) => Math.max(5, Math.ceil(Math.max(0, seconds) / 300) * 5);

export function durationLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} год${rest ? ` ${rest} хв` : ''}` : `${minutes} хв`;
}

const clock = (ms) => new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Kyiv' });

/** Той самий формат за готовою кількістю секунд: «≈ 50 хв · до 21:30». */
export function estimateFromSeconds(seconds, now = Date.now()) {
  const minutes = roundMinutes(seconds);
  const endAt = now + minutes * 60_000;
  return { seconds, minutes, endAt, text: `≈ ${durationLabel(minutes)} · до ${clock(endAt)}` };
}

/**
 * @param {{platform: 'viber'|'whatsapp'|'telegram', remaining: number, finishedAt?: number[], perHour?: number, canaryPending?: boolean, now?: number}} input
 * @returns {{seconds: number, minutes: number, endAt: number, text: string}} text — «≈ 50 хв · до 21:30»
 */
export function estimateBatch({ platform, remaining, finishedAt = [], perHour = 0, canaryPending = false, now = Date.now() }) {
  const seconds = Math.max(0, remaining) * secondsPerChat(platform, finishedAt, perHour) + (canaryPending ? (CANARY_SECONDS[platform] ?? 30) : 0);
  return estimateFromSeconds(seconds, now);
}
