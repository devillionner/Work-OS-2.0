// A failed/slow request must not turn a one-second UI clock into a network loop.
export function createRefreshGate(intervalMs: number) {
  let lastAttempt = -Infinity;
  let pending = false;
  return async function refresh(now: number, eligible: boolean, action: () => Promise<void>) {
    if (!eligible || pending || now - lastAttempt < intervalMs) return;
    lastAttempt = now;
    pending = true;
    try { await action(); } finally { pending = false; }
  };
}
