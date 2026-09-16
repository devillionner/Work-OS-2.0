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

type Row = {
  id: string;
  goal_key: GoalHistoryItem['key'];
  effective_on: string;
  value: number;
  created_at: number;
  source: string;
  version: number;
};

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const result = await env.DB.prepare(`SELECT id,goal_key,effective_on,value,created_at,source,version
    FROM goal_versions
    WHERE user_id=?1 AND goal_key IN ('daily_booking_goal','monthly_booking_goal')
    ORDER BY effective_on DESC,created_at DESC,version DESC
    LIMIT 200`).bind(user.id).all<Row>();
  const history: GoalHistoryItem[] = result.results.map((row) => ({
    id: row.id,
    key: row.goal_key,
    effectiveOn: row.effective_on,
    value: Number(row.value || 0),
    createdAt: Number(row.created_at || 0),
    source: row.source || 'unknown',
    version: Number(row.version || 1),
  }));
  return Response.json({ history }, { headers: { 'Cache-Control': 'no-store' } });
}
