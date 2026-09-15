import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readSyncRevision } from '@/lib/sync-revision';

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });

  return Response.json(
    { revision: await readSyncRevision(env.DB, user.id) },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache',
      },
    },
  );
}
