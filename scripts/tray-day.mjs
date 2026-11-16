// Підсумок автопосту для значка runner у верхній панелі (GNOME не показує підказок, тож число стоїть поруч зі значком).
// Усе береться з того, що runner уже отримує: лічильники дня в задачі (`progress`, разом із базою партії від DO), інтервал платформи
// (`autopost_pace`), результати задач і підсумок партії (`autopost_summary`). Жодних запитів до D1 і мережі.
// Числа ті самі, що в картці поточної партії: «партія N з M», окремо «сьогодні N з M» (день разом з відправленим поза партією).
import { estimateBatch } from '../lib/autopost-estimate.mjs';

const PLATFORMS = [
  { id: 'viber', name: 'Viber', kinds: ['viber_android'] },
  { id: 'telegram', name: 'Telegram', kinds: ['telegram_autopost'] },
  { id: 'whatsapp', name: 'WhatsApp', kinds: ['whatsapp_autopost'] },
];

export function platformOfKind(kind) {
  return PLATFORMS.find((item) => item.kinds.includes(String(kind)))?.id || null;
}

const dayKey = (at) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(at);
const clock = (at) => new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
const count = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0);

/** @param {{now?: () => number}} [options] */
export function createDayState({ now = () => Date.now() } = {}) {
  let key = dayKey(now());
  /** @type {Record<string, any>} */
  let days = {};
  /** @type {Map<string, string>} jobId → platform */
  const jobs = new Map();
  let current = null;

  function roll() {
    const today = dayKey(now());
    if (today === key) return;
    key = today;
    days = {};
    jobs.clear();
  }
  function entry(platform) {
    roll();
    // day — лічильники дня; batch — поточна партія (день мінус база на старті партії); finishedAt — моменти завершення задач сьогодні.
    return (days[platform] ||= { known: false, day: { sent: 0, total: 0, failed: 0, decision: 0 }, batch: null, nextAt: 0, intervalSeconds: 0, finishedAt: [] });
  }

  return {
    /** Задачу видано: лічильники дня платформи (сервер порахував їх при видачі) і база партії, яку додає DO. */
    onClaim(kind, task) {
      const platform = platformOfKind(kind);
      if (!platform || !task?.jobId) return;
      jobs.set(String(task.jobId), platform);
      const progress = task.progress;
      if (!progress || !(Number(progress.total) > 0)) return;
      const item = entry(platform);
      item.known = true;
      item.day = { total: count(progress.total), sent: count(progress.sent), failed: count(progress.failed), decision: count(progress.decision) };
      const base = progress.base;
      if (base && Number.isFinite(Number(base.total))) {
        item.batch = {
          total: Math.max(0, item.day.total - count(base.total)),
          sent: Math.max(0, item.day.sent - count(base.sent)),
          failed: Math.max(0, item.day.failed - count(base.failed)),
        };
      } else item.batch = { total: item.day.total, sent: item.day.sent, failed: item.day.failed };
    },
    setCurrent(platform) { current = platform || null; },
    /** Результат задачі: відправлено — +1 одразу; решту (рішення, архів, пропуск) уточнить наступна видача чи підсумок партії. */
    onResult(jobId, status, { counts = true } = {}) {
      const platform = jobs.get(String(jobId));
      if (!platform) return;
      if (current === platform) current = null;
      if (!counts) return;
      const item = entry(platform);
      item.finishedAt = [...item.finishedAt, now()].slice(-12);
      if (status === 'sent') { item.day.sent += 1; if (item.batch) item.batch.sent += 1; }
      else if (item.batch) item.batch.failed += 1;
    },
    onPace(platform, nextAt, intervalSeconds = 0) {
      if (!PLATFORMS.some((item) => item.id === platform)) return;
      const item = entry(platform);
      item.nextAt = count(nextAt);
      if (intervalSeconds > 0) item.intervalSeconds = count(intervalSeconds);
    },
    onSummary(message) {
      const platform = String(message?.platform || '');
      if (!PLATFORMS.some((item) => item.id === platform) || !(Number(message.total) > 0)) return;
      const item = entry(platform);
      item.known = true;
      item.batch = { total: count(message.total), sent: count(message.sent), failed: Math.max(0, count(message.total) - count(message.sent)) };
      item.day.decision = count(message.decision);
      item.nextAt = 0;
    },
    /** Що показує трей: мітка біля значка («Viber 1/79», лише поки партія йде), рядки платформ і «Потребують рішення». */
    snapshot({ active }) {
      roll();
      const at = now();
      let decision = 0;
      let best = null;
      const platforms = PLATFORMS.map(({ id, name }) => {
        const item = days[id];
        if (!item?.known) return { id, name, decision: 0, text: `${name} —` };
        decision += item.day.decision;
        const batch = item.batch || { total: item.day.total, sent: item.day.sent, failed: item.day.failed };
        const left = Math.max(0, batch.total - batch.sent - batch.failed);
        let state = '';
        if (current === id) state = 'іде';
        else if (left > 0 && item.nextAt > at) state = `наступна о ${clock(item.nextAt)}`;
        else if (left > 0) state = 'у черзі';
        else state = 'завершено';
        const estimate = left > 0
          ? ` · ${estimateBatch({ platform: id, remaining: left, finishedAt: item.finishedAt, perHour: item.intervalSeconds ? 3600 / item.intervalSeconds : 0, now: at }).text}`
          : '';
        const dayText = item.day.total !== batch.total ? ` · сьогодні ${item.day.sent} з ${item.day.total}` : '';
        if (left > 0 && (!best || current === id || (best.id !== current && left > best.left))) best = { id, name, left, batch };
        return { id, name, decision: item.day.decision, text: `${name}: партія ${batch.sent} з ${batch.total}${dayText} · ${state}${estimate}` };
      });
      return { label: active && best ? `${best.name} ${best.batch.sent}/${best.batch.total}` : '', platforms, decision };
    },
  };
}
