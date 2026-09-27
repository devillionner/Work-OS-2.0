import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { getDashboardSnapshot } from '@/lib/dashboard';
import { isD1DailyRowReadLimit } from '@/lib/d1-errors';
import { readSyncRevision } from '@/lib/sync-revision';

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return json({ error: 'Потрібна авторизація.' }, 401);

  try {
    const [snapshot, syncRevision] = await Promise.all([
      getDashboardSnapshot(user.id),
      readSyncRevision(env.DB, user.id),
    ]);
    return json({ snapshot, syncRevision });
  } catch (error) {
    if (isD1DailyRowReadLimit(error)) {
      return json({
        error: 'Work OS досяг денного ліміту читання Cloudflare D1. Дані не пошкоджені.',
        code: 'd1_daily_read_limit',
      }, 429);
    }
    console.error('Dashboard bootstrap failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Не вдалося завантажити робочі дані.' }, 500);
  }
}
