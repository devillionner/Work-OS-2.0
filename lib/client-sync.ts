export const DATA_SYNC_EVENT = 'work-os:data-sync';
export const DATA_SYNC_CHANNEL = 'work-os-data';
export const DATA_SYNC_REQUEST_EVENT = 'work-os:data-sync-request';

export type DataSyncScope =
  | 'all'
  | 'dashboard'
  | 'workday'
  | 'platforms'
  | 'leads'
  | 'analytics'
  | 'reports'
  | 'library'
  | 'settings';

export type DataSyncDetail = {
  scope: DataSyncScope;
  reason: 'poll' | 'focus' | 'online' | 'local-write' | 'cross-tab';
  at: number;
};

/**
 * Announces a successful local mutation to this tab and sibling tabs.
 * Cross-device freshness is handled by the periodic server-sync heartbeat.
 */
export function announceDataChange(scope: DataSyncScope = 'all'): void {
  if (typeof window === 'undefined') return;
  const detail: DataSyncDetail = { scope, reason: 'local-write', at: Date.now() };
  window.dispatchEvent(new CustomEvent<DataSyncDetail>(DATA_SYNC_EVENT, { detail }));
  if (!('BroadcastChannel' in window)) return;
  const channel = new BroadcastChannel(DATA_SYNC_CHANNEL);
  channel.postMessage(detail);
  channel.close();
}


export function requestDataSync(reason: 'focus' | 'online' = 'focus'): void {
  if (typeof window === 'undefined') return;
  const detail: DataSyncDetail = { scope: 'all', reason, at: Date.now() };
  window.dispatchEvent(new CustomEvent<DataSyncDetail>(DATA_SYNC_REQUEST_EVENT, { detail }));
}
