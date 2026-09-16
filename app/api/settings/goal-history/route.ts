import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';

export type GoalHistoryItem = {
  id: string;
  key: 'daily_booking_goal' | 'monthly_booking_goal';
  effectiveOn: string;
  value: number;
  createdAt: number;
  source: string;
  version: number;
};

export type UnversionedGoal = {
  key: GoalHistoryItem['key'];
  value: number;
  updatedAt: number;
};

type Row = {
  id: string;
  goal_key: GoalHistoryItem['key'];
  effective_on: string;
  value: number;
  created_at: number;
  source: string;
  version: number;
};

type SettingRow = {
  setting_key: GoalHistoryItem['key'];
  value_json: string;
  updated_at: number;
};

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const [versionResult, settingResult] = await env.DB.batch([
    env.DB.prepare(`SELECT id,goal_key,effective_on,value,created_at,source,version
      FROM goal_versions
      WHERE user_id=?1 AND goal_key IN ('daily_booking_goal','monthly_booking_goal')
      ORDER BY effective_on DESC,created_at DESC,version DESC
      LIMIT 200`).bind(user.id),
    env.DB.prepare(`SELECT setting_key,value_json,updated_at
      FROM user_settings
      WHERE user_id=?1 AND setting_key IN ('daily_booking_goal','monthly_booking_goal')`).bind(user.id),
  ]);
  const history: GoalHistoryItem[] = (versionResult.results as Row[]).map((row) => ({
    id: row.id,
    key: row.goal_key,
    effectiveOn: row.effective_on,
    value: Number(row.value || 0),
    createdAt: Number(row.created_at || 0),
    source: row.source || 'unknown',
    version: Number(row.version || 1),
  }));
  const versionedKeys = new Set(history.map((item) => item.key));
  const unversioned: UnversionedGoal[] = (settingResult.results as SettingRow[])
    .filter((row) => !versionedKeys.has(row.setting_key))
    .flatMap((row) => {
      const value = parseGoal(row.value_json);
      return value === null ? [] : [{
        key: row.setting_key,
        value,
        updatedAt: Number(row.updated_at || 0),
      }];
    });
  return Response.json({ history, unversioned }, { headers: { 'Cache-Control': 'no-store' } });
}

function parseGoal(valueJson: string): number | null {
  try {
    const value: unknown = JSON.parse(valueJson);
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}
