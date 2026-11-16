// Підсумок автопосту для значка runner у верхній панелі (GNOME не показує підказок, тож число стоїть поруч зі значком).
// Усе береться з того, що runner уже отримує: лічильники дня в задачі (`progress`), інтервал платформи (`autopost_pace`),
// результати задач і підсумок партії (`autopost_summary`). Жодних запитів до D1 і мережі.

const PLATFORMS = [
  { id: 'viber', name: 'Viber', kinds: ['viber_android'] },
  { id: 'telegram', name: 'Telegram', kinds: ['telegram_autopost'] },
  { id: 'whatsapp', name: 'WhatsApp', kinds: ['whatsapp_autopost'] },
];

export function platformOfKind(kind) {
  return PLATFORMS.find((item) => item.kinds.includes(String(kind)))?.id || null;
}

function dayKey(at) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(at);
}

function clock(at) {
  return new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

const count = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0);

/** @param {{now?: () => number}} [options] */
export function createDayState({ now = () => Date.now() } = {}) {
  let key = dayKey(now());
  /** @type {Record<string, {sent:number,done:number,total:number,decision:number,nextAt:number,known:boolean}>} */
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
    return (days[platform] ||= { sent: 0, done: 0, total: 0, decision: 0, nextAt: 0, known: false });
  }

  return {
    /** Задачу видано: лічильники дня платформи (сервер порахував їх при видачі). */
    onClaim(kind, task) {
      const platform = platformOfKind(kind);
      if (!platform || !task?.jobId) return;
      jobs.set(String(task.jobId), platform);
      const progress = task.progress;
      if (!progress || !(Number(progress.total) > 0)) return;
      const item = entry(platform);
      item.known = true;
      item.total = count(progress.total);
      item.done = count(progress.done);
      if (progress.sent !== undefined) item.sent = count(progress.sent);
      else item.sent = Math.min(item.sent, item.done);
      if (progress.decision !== undefined) item.decision = count(progress.decision);
    },
    setCurrent(platform) { current = platform || null; },
    /** Результат задачі: відправлено — одразу +1; решту (рішення, архів, пропуск) уточнить підсумок чи наступна видача. */
    onResult(jobId, status, { counts = true } = {}) {
      const platform = jobs.get(String(jobId));
      if (!platform) return;
      if (current === platform) current = null;
      if (!counts) return;
      const item = entry(platform);
      item.done = Math.min(item.total || Infinity, item.done + 1);
      if (status === 'sent') item.sent += 1;
    },
    onPace(platform, nextAt) {
      if (!PLATFORMS.some((item) => item.id === platform)) return;
      entry(platform).nextAt = count(nextAt);
    },
    onSummary(message) {
      const platform = String(message?.platform || '');
      if (!PLATFORMS.some((item) => item.id === platform) || !(Number(message.total) > 0)) return;
      const item = entry(platform);
      item.known = true;
      item.sent = count(message.sent);
      item.total = count(message.total);
      item.done = item.total;
      item.decision = count(message.decision);
      item.nextAt = 0;
    },
    /** Що показує трей: число біля значка (лише поки партія йде), рядок на платформу й «Потребують рішення». */
    snapshot({ active }) {
      roll();
      const at = now();
      let sent = 0;
      let total = 0;
      let decision = 0;
      let running = false;
      const platforms = PLATFORMS.map(({ id, name }) => {
        const item = days[id];
        if (!item?.known) return { id, name, decision: 0, text: `${name} —` };
        const left = Math.max(0, item.total - item.done);
        sent += item.sent;
        total += item.total;
        decision += item.decision;
        let state = '';
        if (current === id) state = 'іде';
        else if (left > 0 && item.nextAt > at) state = `наступна о ${clock(item.nextAt)}`;
        else if (left > 0) state = 'у черзі';
        else state = 'завершено';
        if (left > 0) running = true;
        return { id, name, decision: item.decision, text: `${name} ${item.sent} з ${item.total} · ${state}` };
      });
      return { label: active && running && total > 0 ? `${sent}/${total}` : '', platforms, decision };
    },
  };
}
