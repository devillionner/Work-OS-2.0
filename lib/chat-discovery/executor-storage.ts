// The local runner reads the executor token from this browser's localStorage over CDP.
export const EXECUTOR_TOKEN_STORAGE_KEY = 'work-os:executor-token:v1';
export const EXECUTOR_DEVICE_STORAGE_KEY = 'work-os:executor-device:v1';

export function hasStoredExecutorToken() {
  try { return Boolean(window.localStorage.getItem(EXECUTOR_TOKEN_STORAGE_KEY)); } catch { return false; }
}

export function storeExecutorToken(token: string, deviceId: string) {
  window.localStorage.setItem(EXECUTOR_TOKEN_STORAGE_KEY, token);
  window.localStorage.setItem(EXECUTOR_DEVICE_STORAGE_KEY, deviceId);
}

// One-click pairing for the runner: creates an executor and keeps its token only in this browser.
export async function pairThisBrowserExecutor(name = 'Цей браузер') {
  const response = await fetch('/api/chat-discovery', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pair-executor', name }),
  });
  const payload = await response.json().catch(() => ({})) as { token?: string; device?: { id: string }; error?: string };
  if (!response.ok || !payload.token || !payload.device?.id) throw new Error(payload.error || 'Не вдалося підключити цей браузер.');
  storeExecutorToken(payload.token, payload.device.id);
}
