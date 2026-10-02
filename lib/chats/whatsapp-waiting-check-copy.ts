// Client-safe copy for the WhatsApp Waiting check status panel.
export type WaitingCheckView = {
  active: boolean;
  total: number;
  remaining: number;
  counts: { joined: number; pending: number; requested: number; failed: number; skipped: number };
  problems: Array<{ chatId: string; name: string; reason: string; chat?: { link: string; stateToken: string } }>;
  stopReason: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  lastActivityAt: number | null;
  currentName: string | null;
  runnerSeenAt: number | null;
};

export const EMPTY_WAITING_CHECK: WaitingCheckView = {
  active: false, total: 0, remaining: 0,
  counts: { joined: 0, pending: 0, requested: 0, failed: 0, skipped: 0 },
  problems: [], stopReason: null, startedAt: null, finishedAt: null, lastActivityAt: null, currentName: null, runnerSeenAt: null,
};

const REASONS: Record<string, string> = {
  invalid_whatsapp_link: 'посилання недійсне або скинуте',
  whatsapp_chat_missing: 'групи більше не існує',
  whatsapp_removed_from_group: 'вас вилучили з цієї групи',
  whatsapp_join_retry_later: 'WhatsApp просить повторити пізніше',
  membership_left: 'ви вийшли з цієї групи',
  target_not_verified: 'не вдалося підтвердити, що відкрито саме цю групу',
  membership_not_confirmed: 'WhatsApp не показав стан заявки',
  expected_control_disappeared: 'кнопка вступу зникла до натискання',
  action_unconfirmed: 'дію у WhatsApp не підтверджено',
  cdp_unavailable: 'браузер WhatsApp недоступний',
};

export function waitingCheckReasonLabel(reason: string) {
  return REASONS[reason] || reason;
}

export function waitingCheckSummary(view: WaitingCheckView) {
  const { joined, pending, requested, failed, skipped } = view.counts;
  const parts = [`прийнято ${joined}`, `відкладено ${pending + requested}`];
  if (requested) parts.push(`із них запитів надіслано ${requested}`);
  parts.push(`проблем ${failed}`);
  if (skipped) parts.push(`пропущено ${skipped}`);
  return parts.join(' · ');
}

export function waitingCheckRunnerOffline(view: WaitingCheckView, nowSeconds: number) {
  if (!view.active) return false;
  // The runner heartbeat is written at most once a minute; three silent minutes mean it is not running.
  const lastSign = Math.max(view.runnerSeenAt ?? 0, view.lastActivityAt ?? 0);
  return nowSeconds - Math.max(lastSign, view.startedAt ?? 0) > 180;
}

const RUNNER_ONLINE_SECONDS = 180;

// Runner state shown at all times, not only during a batch, so the operator sees it before starting.
export function waitingCheckRunnerState(view: WaitingCheckView, nowSeconds: number) {
  if (view.runnerSeenAt === null) return { online: false, label: 'Runner ще не підключався' };
  if (nowSeconds - view.runnerSeenAt <= RUNNER_ONLINE_SECONDS) return { online: true, label: 'Runner підключено' };
  const seen = new Date(view.runnerSeenAt * 1000);
  const time = seen.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  const sameDay = new Date(nowSeconds * 1000).toDateString() === seen.toDateString();
  return { online: false, label: `Runner не працює · востаннє ${sameDay ? time : `${seen.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })}, ${time}`}` };
}

export function waitingCheckDone(view: WaitingCheckView) {
  return Math.max(0, view.total - view.remaining);
}

// Remaining time from the pace of this batch; null until at least one chat has been checked.
export function waitingCheckEtaMinutes(view: WaitingCheckView) {
  const done = waitingCheckDone(view);
  if (!view.active || done < 1 || view.startedAt === null || view.lastActivityAt === null) return null;
  const perChat = Math.max(1, view.lastActivityAt - view.startedAt) / done;
  return Math.max(1, Math.round(perChat * view.remaining / 60));
}

export function parseWaitingCheckView(body: unknown): WaitingCheckView {
  const raw = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const counts = raw.counts && typeof raw.counts === 'object' ? raw.counts as Record<string, unknown> : {};
  const count = (value: unknown) => Math.max(0, Number(value) || 0);
  const time = (value: unknown) => Number.isSafeInteger(value) ? Number(value) : null;
  return {
    active: raw.active === true,
    total: count(raw.total),
    remaining: count(raw.remaining),
    counts: { joined: count(counts.joined), pending: count(counts.pending), requested: count(counts.requested), failed: count(counts.failed), skipped: count(counts.skipped) },
    problems: Array.isArray(raw.problems) ? raw.problems.filter((item): item is WaitingCheckView['problems'][number] =>
      Boolean(item && typeof item === 'object' && typeof (item as {name?:unknown}).name === 'string' && typeof (item as {reason?:unknown}).reason === 'string')).slice(-30)
      .map(item => {
        const chat = item.chat && typeof item.chat.link === 'string' && typeof item.chat.stateToken === 'string' ? { link: item.chat.link, stateToken: item.chat.stateToken } : undefined;
        return { chatId: item.chatId, name: item.name, reason: item.reason, ...(chat ? { chat } : {}) };
      }) : [],
    stopReason: typeof raw.stopReason === 'string' ? raw.stopReason : null,
    startedAt: time(raw.startedAt),
    finishedAt: time(raw.finishedAt),
    lastActivityAt: time(raw.lastActivityAt),
    currentName: typeof raw.currentName === 'string' ? raw.currentName : null,
    runnerSeenAt: time(raw.runnerSeenAt),
  };
}

// Default archive reason offered for a problem chat, in the operator's words.
export function waitingCheckArchiveReason(reason: string) {
  if (reason === 'whatsapp_removed_from_group') return 'Вас вилучено з групи';
  if (reason === 'whatsapp_join_retry_later') return 'WhatsApp не дає вступити';
  if (reason === 'invalid_whatsapp_link' || reason === 'whatsapp_chat_missing') return 'Чат не існує';
  return 'Проблема з заявкою';
}
