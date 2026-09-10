import { env } from 'cloudflare:workers';
import { readDashboardSnapshot } from './dashboard-data';
export type { DashboardSnapshot } from './dashboard-data';

export function getDashboardSnapshot(userId: string) {
  return readDashboardSnapshot(env.DB, userId, Math.floor(Date.now() / 1000));
}
