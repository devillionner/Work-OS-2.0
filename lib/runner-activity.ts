// The local runner reads this over CDP (no network, no D1) to decide whether to poll Work OS at all:
// it polls only while the operator used the site recently or while it still has work to finish.
export const RUNNER_ACTIVITY_STORAGE_KEY = 'work-os:last-active-at:v1';
const WRITE_THROTTLE_MS = 30_000;

let lastWrite = 0;

export function noteRunnerActivity(now = Date.now()) {
  if (now - lastWrite < WRITE_THROTTLE_MS) return;
  lastWrite = now;
  try { window.localStorage.setItem(RUNNER_ACTIVITY_STORAGE_KEY, String(now)); } catch {}
}
